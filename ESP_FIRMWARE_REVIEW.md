# ESP 固件源码交付

本次已克隆作者仓库并修改源码，未编译或烧录。完整发现、版本对照、修改清单及 Linux 构建步骤见 [LINUX_BUILD_HANDOFF.md](leap_ros_four_mcu_driver/doc/LINUX_BUILD_HANDOFF.md)。

- 源码目录：`leap_ros_four_mcu_driver/`。
- 基准：较新的 `origin/v1.1`，提交 `d2690b35fc0dff95fa65f48dd2820bc2d29cc4c8`。
- 本地分支：`local/communication-review`；修改未提交。
- 本地固件标识：`v1.1-d2690b3-local`。
- 统一交付压缩包：`esp固件.zip`，包含本说明、修改后的完整源码和工程所需随附组件，源码使用 LF 换行。解压后阅读 `leap_ros_four_mcu_driver/doc/LINUX_BUILD_HANDOFF.md`。
- 先前的 Linux 源码包 `esp32-v1.1-review-source.tar.gz` 保留，内容对应同一批源码修改；使用 `esp固件.zip` 无需再下载该源码包。

需要特别核对的版本区别：默认 `main` 为 UDP/460800；公开标签 `leap_ros_prov1.1` 的代码为 UDP/921600（标签文档的波特率未同步）；10 月 4 日 `v1.1` 分支为 UART/921600。升级应用通常保留 NVS，因此旧的 UDP 选择仍可能有效。当前板上版本与实际协议尚未确认。

本次修改使 UART 波特率可配置、BOOT 协议切换保存后重启生效，并在 ESP 网页/API 显示当前协议、波特率和固件构建信息。安装本地构建后才能看到新增诊断字段，Linux 编译与实际通信尚待验证。
