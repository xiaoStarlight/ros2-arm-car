#!/usr/bin/env bash
set -eo pipefail

source /opt/ros/humble/setup.bash
if [[ -f /root/chuyun_ws/install/setup.bash ]]; then
  source /root/chuyun_ws/install/setup.bash
fi

pids=()

stop_children() {
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}

trap stop_children EXIT INT TERM

# /tf is multiplexed: map->odom and odom->base_footprint arrive in separate
# messages. Publish a 12 Hz snapshot containing the newest value of every edge.
ros2 run xuegecar_bringup web_tf_aggregator \
  --ros-args -p publish_rate:=12.0 -p max_transform_age:=2.0 &
pids+=("$!")

# Keep the TF aggregator alive even on systems where topic_tools is not installed.
# The odometry throttle is optional; TF is required by the web console.
if ros2 pkg prefix topic_tools >/dev/null 2>&1; then
  ros2 run topic_tools throttle messages /odometry/filtered 10.0 /web/odometry/filtered \
    --ros-args -r __node:=web_odom_throttle -p lazy:=true &
  pids+=("$!")
else
  echo "[ros2-web-topic-throttle] topic_tools is not installed; skipping odometry throttle" >&2
fi

wait -n "${pids[@]}"
