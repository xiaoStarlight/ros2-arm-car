# 主控服务配置快照

这些文件从当前 S905L3A 读取，供复现部署和审查。文件路径、串口、ROS 工作空间和安装位置与原设备有关，不能直接当作任意 Ubuntu 系统的通用安装器。

- `micro_ros/`：micro-ROS Agent unit、UART 启动脚本及 `/wifi_config` 心跳监控。历史实测使用 `/dev/ttyAML0`、921600。
- `bringup/`：原 ROS 2 bringup 服务。
- `web/`：网页 TF/里程计节流服务，配套脚本也在 `ros2_web/`。
- `wifi-config-applier/`：原 WiFi 服务及 `90-manual-host-wifi.conf` 覆盖，让 WiFi 节点订阅 `/wifi_config_manual_only`；原 `/wifi_config` 心跳与 `/host_info` 保留。
- `mediamtx/`：设备上的 MediaMTX service。实际二进制、摄像头地址及带认证的配置不随源码导出；不要用示例覆盖现有正常配置。

没有安装/重启脚本在发布源码时自动执行。本次仓库整理没有改变设备运行配置。
