# 源码来源与许可说明

本仓库汇集设备现有软件、上游组件和项目二次开发内容，不把整套小车代码描述为从零原创，也不为所有文件统一追加新的开源许可。

| 部分 | 来源与说明 |
| --- | --- |
| `ros2_web/` | 从用户当前 S905L3A `/root/ros2_web` 导出；原中控台基础功能与本项目新增的颜色识别、跟随、角度限制和发送记忆并存 |
| `chuyun_ws/src/` | 从用户当前 S905L3A `/root/chuyun_ws/src` 导出，包含厂商 ROS 包、GMapping 和 micro-ROS 等上游代码 |
| `leap_ros_four_mcu_driver/` | 上游 `https://github.com/czu963889306-dev/leap_ros_pro_mcu_driver.git`，本地参考基准 `d2690b35fc0dff95fa65f48dd2820bc2d29cc4c8`，包含本地适配，具体见 `FIRMWARE_SOURCE.json` |
| `device_config/` | 用户设备正在使用的服务与启动器快照；示例配置有单独标注，部署需按设备核对 |
| `docs/images/` | 用户为本项目提供的机械臂、小车和相机画面 |
| `espcar.bin` | 用户提供并确认当前小车 ESP 控制板正在使用的固件；文件内工程标识 `leap_ros_four`、版本 `v1.1-d2690b3-local`，校验值见 `espcar.bin.sha256` |

原有 LICENSE、NOTICE、源码版权头、包描述及组件元数据均保留。具体组件遵循其对应许可；部分厂商包的 package.xml 许可声明仍是 TODO，不能据此推断已取得某个统一开源协议。本仓库用于二次开发项目的公开展示，来源归属与组件许可按原文件记录。

`SOURCE_SNAPSHOT.json` 记录主控来源及文件原始 SHA256，排除 Git 元数据、构建/安装输出、依赖目录、地图和录包、环境密钥文件与固件二进制。本地 MCU 导出统一文本 LF 换行，没有运行 ESP 编译。主控源码快照与 MCU 参考工作树不是“烧录版本完全一致”的证明。
