#!/usr/bin/env python3
import os
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy
from std_msgs.msg import String


class MicroRosUartStarter(Node):
    def __init__(self):
        super().__init__('maturo_microros_uart_starter')
        self.dev = os.environ.get('MICROROS_SERIAL_DEV', '/dev/ttyAML0')
        self.start_cmd = os.environ.get('MICROROS_START_CMD', 'MATURO_MICROROS_START')
        self.start_interval = float(os.environ.get('MICROROS_START_INTERVAL', '1.0'))
        self.online_timeout = float(os.environ.get('MICROROS_ONLINE_TIMEOUT', '3.0'))
        self.heartbeat_topic = os.environ.get('MICROROS_HEARTBEAT_TOPIC', '/wifi_config')
        self.last_msg_time = 0.0
        self.was_online = False
        self.last_send_log_time = 0.0

        qos = QoSProfile(depth=10)
        qos.reliability = ReliabilityPolicy.BEST_EFFORT
        self.create_subscription(String, self.heartbeat_topic, self._on_heartbeat, qos)
        self.create_timer(self.start_interval, self._tick)
        self.get_logger().info(
            f'watching {self.heartbeat_topic}; sending {self.start_cmd} to {self.dev} '
            f'every {self.start_interval:.1f}s when stale for {self.online_timeout:.1f}s'
        )

    def _on_heartbeat(self, msg):
        self.last_msg_time = time.monotonic()
        if not self.was_online:
            self.get_logger().info(f'{self.heartbeat_topic} received; pause UART start command')
        self.was_online = True

    def _is_online(self):
        return self.last_msg_time > 0.0 and (time.monotonic() - self.last_msg_time) <= self.online_timeout

    def _send_start(self):
        try:
            fd = os.open(self.dev, os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
            try:
                os.write(fd, (self.start_cmd + '\n').encode('ascii'))
            finally:
                os.close(fd)
        except OSError as exc:
            self.get_logger().warning(f'failed to write UART start command: {exc}')
            return

        now = time.monotonic()
        if now - self.last_send_log_time >= 10.0:
            self.get_logger().info('sent UART start command; waiting for fresh heartbeat')
            self.last_send_log_time = now

    def _tick(self):
        if self._is_online():
            return
        if self.was_online:
            self.get_logger().warning(f'{self.heartbeat_topic} stale; resume UART start command')
        self.was_online = False
        self._send_start()


def main():
    rclpy.init()
    node = MicroRosUartStarter()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
