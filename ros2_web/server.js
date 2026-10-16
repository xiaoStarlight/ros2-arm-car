import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// 记录所有后端的子进程
let activeProcesses = {};

const NAVIGATION_PARAM_FILES = Object.freeze({
    omni: '/root/chuyun_ws/install/xuegecar_navigation2/share/xuegecar_navigation2/config/lite_navigation_omni.yaml',
    diff: '/root/chuyun_ws/install/xuegecar_navigation2/share/xuegecar_navigation2/config/lite_navigation_diff.yaml'
});

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// 加载配置文件
function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'ros_config.json');
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('无法读取配置文件:', err);
        return { tasks: { mapping: [] } };
    }
}

// 运行时配置（前端可读取的可配置项）
app.get('/api/runtime_config', (req, res) => {
    const config = loadConfig();
    res.json({
        topics: config.topics || {},
        services: config.services || {},
        camera: config.camera || {}
    });
});

// 提交机械臂末端位姿。success=true 仅表示控制器已接受目标。
app.post('/api/arm/pose', (req, res) => {
    const fields = ['x', 'y', 'z', 'pitch_deg'];
    const request = Object.fromEntries(fields.map((field) => [field, Number(req.body?.[field])]));
    if (fields.some((field) => !Number.isFinite(request[field]))) {
        return res.status(400).json({ success: false, error: 'X、Y、Z 和俯仰角必须是有效数字' });
    }

    const config = loadConfig();
    const serviceName = config.services?.set_arm_pose || '/set_arm_pose';
    if (!/^\/[a-zA-Z0-9_/]+$/.test(serviceName)) {
        return res.status(500).json({ success: false, error: '机械臂服务名配置无效' });
    }

    const payload = `{x: ${request.x}, y: ${request.y}, z: ${request.z}, pitch_deg: ${request.pitch_deg}}`;
    const command = [
        'source /opt/ros/humble/setup.bash',
        'source /root/chuyun_ws/install/setup.bash',
        `ros2 service call ${serviceName} leap_interfaces/srv/SetArmPose '${payload}'`
    ].join(' && ');

    const proc = spawn('bash', ['-lc', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let replied = false;

    const finish = (status, body) => {
        if (replied) return;
        replied = true;
        clearTimeout(timer);
        res.status(status).json(body);
    };

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('error', (error) => finish(500, { success: false, error: error.message }));
    proc.on('close', (code) => {
        if (code !== 0) {
            return finish(502, { success: false, error: stderr.trim() || `ROS 2 服务调用失败，退出码 ${code}` });
        }
        const accepted = /success\s*[=:]\s*(?:true|True)/.test(stdout);
        finish(accepted ? 200 : 422, {
            success: accepted,
            accepted,
            message: accepted ? '机械臂目标已提交' : '机械臂控制器拒绝了该目标',
            response: stdout.trim()
        });
    });

    const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        finish(504, { success: false, error: '等待机械臂服务响应超时' });
    }, 10000);
});

async function fetchMediaMtxJson(baseUrl, path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
        const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`MediaMTX API ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

// 合并 MediaMTX 当前在线路径与已配置路径，供前端自动发现 WebRTC 通道。
app.get('/api/camera/streams', async (req, res) => {
    const config = loadConfig();
    const camera = config.camera || {};
    const apiBaseUrl = camera.mediamtx_api_url || 'http://127.0.0.1:9997';
    const streamMap = new Map();

    try {
        const results = await Promise.allSettled([
            fetchMediaMtxJson(apiBaseUrl, '/v3/paths/list'),
            fetchMediaMtxJson(apiBaseUrl, '/v3/config/paths/list')
        ]);

        const runtimeItems = results[0].status === 'fulfilled' ? (results[0].value.items || []) : [];
        const configuredItems = results[1].status === 'fulfilled' ? (results[1].value.items || []) : [];

        configuredItems.forEach((item) => {
            if (item?.name && item.name !== 'all_others') {
                streamMap.set(item.name, { name: item.name, ready: false, tracks: [] });
            }
        });

        runtimeItems.forEach((item) => {
            if (item?.name) {
                streamMap.set(item.name, {
                    name: item.name,
                    ready: Boolean(item.ready),
                    tracks: Array.isArray(item.tracks) ? item.tracks : []
                });
            }
        });

        const preferredPath = camera.preferred_webrtc_path || '';
        const streams = [...streamMap.values()].sort((a, b) => {
            if (a.ready !== b.ready) return a.ready ? -1 : 1;
            if (a.name === preferredPath) return -1;
            if (b.name === preferredPath) return 1;
            return a.name.localeCompare(b.name);
        });

        res.json({
            streams,
            webrtcPort: Number(camera.webrtc_port) || 8889,
            fallbackUrl: camera.stream_url || ''
        });
    } catch (error) {
        res.status(503).json({
            streams: [],
            webrtcPort: Number(camera.webrtc_port) || 8889,
            fallbackUrl: camera.stream_url || '',
            error: error.message
        });
    }
});

// 通用启动任务接口
app.post('/api/run_task/:taskName', (req, res) => {
    const taskName = req.params.taskName;
    console.log(`收到启动任务请求: ${taskName}`);

    const config = loadConfig();
    const tasks = config.tasks[taskName] || [];

    if (tasks.length === 0) {
        return res.status(404).json({ success: false, error: `任务类别 ${taskName} 未定义或为空` });
    }

    try {
        tasks.forEach((task) => {
            const { id, command, args, delay, description } = task;

            setTimeout(() => {
                if (!activeProcesses[id]) {
                    console.log(`[${id}] 启动: ${description} (${command} ${args.join(' ')})`);

                    // 构造包装命令，确保在 shell 中执行并加载 ROS 环境
                    const robotWorkspaceSetup = '/root/chuyun_ws/install/setup.bash';
                    const fullCommand = `source /opt/ros/humble/setup.bash && source ${robotWorkspaceSetup} && ${command} ${args.join(' ')}`;

                    const proc = spawn('bash', ['-c', fullCommand], {
                        detached: true,
                        stdio: 'inherit'
                    });

                    proc.on('error', (err) => {
                        console.error(`[${id}] 启动错误:`, err.message);
                        activeProcesses[id] = null;
                    });

                    proc.on('exit', (code) => {
                        console.log(`[${id}] 已退出 (代码: ${code})`);
                        activeProcesses[id] = null;
                    });

                    activeProcesses[id] = proc;
                }
            }, delay || 0);
        });

        res.json({ success: true, message: `任务 [${taskName}] 已按配置启动` });
    } catch (error) {
        console.error(`[${taskName}] 启动失败:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 通用停止任务接口
app.post('/api/stop_task/:taskName', (req, res) => {
    const taskName = req.params.taskName;
    console.log(`收到停止任务请求: ${taskName}`);

    const config = loadConfig();
    const tasks = config.tasks[taskName] || [];

    try {
        tasks.forEach((task) => {
            const id = task.id;
            const proc = activeProcesses[id];
            if (proc && proc.pid) {
                try {
                    // 尝试平滑退出
                    process.kill(-proc.pid, 'SIGTERM');
                    console.log(`[${id}] 已发送停止信号`);
                } catch (e) {
                    if (!e.message.includes('ESRCH')) {
                        console.error(`无法停止 ${id}:`, e.message);
                    }
                }
                activeProcesses[id] = null;

            }
        });

        res.json({ success: true, message: `任务 [${taskName}] 已停止` });
    } catch (error) {
        console.error(`[${taskName}] 停止失败:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 状态查询接口 (针对特定任务类别)
app.get('/api/task_status/:taskName', (req, res) => {
    const taskName = req.params.taskName;
    const config = loadConfig();
    const tasks = config.tasks[taskName] || [];

    const isRunning = tasks.some(task => !!activeProcesses[task.id]);
    res.json({ isRunning });
});

// 兼容旧的接口 (映射到 mapping 任务)
app.post('/api/start_mapping', (req, res) => res.redirect(307, '/api/run_task/mapping'));
app.post('/api/stop_mapping', (req, res) => res.redirect(307, '/api/stop_task/mapping'));
app.get('/api/mapping_status', (req, res) => res.redirect(301, '/api/task_status/mapping'));

// 获取地图列表
app.get('/api/list_maps', (req, res) => {
    const config = loadConfig();
    const mapsDir = config.maps_dir || config.save_map?.save_dir || '/tmp';
    try {
        if (!fs.existsSync(mapsDir)) {
            return res.json({ maps: [] });
        }
        const files = fs.readdirSync(mapsDir)
            .filter(f => f.endsWith('.yaml'))
            .map(f => ({
                name: f.replace('.yaml', ''),
                path: path.join(mapsDir, f.replace('.yaml', ''))
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json({ maps: files });
    } catch (err) {
        console.error('[list_maps] 读取地图目录失败:', err);
        res.status(500).json({ maps: [], error: err.message });
    }
});

// 启动导航（支持指定地图和底盘类型）
app.post('/api/start_navigation', (req, res) => {
    const { mapPath, driveType } = req.body;
    if (!mapPath || mapPath.trim() === '') {
        return res.status(400).json({ success: false, error: '请指定地图路径 (mapPath)' });
    }

    const paramsFile = NAVIGATION_PARAM_FILES[driveType];
    if (!paramsFile) {
        return res.status(400).json({
            success: false,
            error: '请选择有效的底盘类型：diff（差速轮）或 omni（全向轮）'
        });
    }

    const config = loadConfig();
    const tasks = config.tasks['navigation'] || [];
    if (tasks.length === 0) {
        return res.status(404).json({ success: false, error: '未找到 navigation 任务配置' });
    }

    const mapsDir = path.resolve(config.maps_dir || config.save_map?.save_dir || '/tmp');
    const mapYaml = path.resolve(`${mapPath}.yaml`);
    if (path.dirname(mapYaml) !== mapsDir || !fs.existsSync(mapYaml)) {
        return res.status(400).json({ success: false, error: '地图路径无效或地图文件不存在' });
    }
    if (!fs.existsSync(paramsFile)) {
        return res.status(500).json({ success: false, error: `导航参数文件不存在: ${paramsFile}` });
    }

    try {
        tasks.forEach((task) => {
            const { id, command, args, delay, description } = task;
            const navArgs = [...args, `map:=${mapYaml}`, `params_file:=${paramsFile}`];

            setTimeout(() => {
                if (!activeProcesses[id]) {
                    console.log(`[${id}] 启动导航: ${description}, 底盘: ${driveType}, 地图: ${mapYaml}, 参数: ${paramsFile}`);
                    const robotWorkspaceSetup = '/root/chuyun_ws/install/setup.bash';
                    const commandLine = [command, ...navArgs].map(shellQuote).join(' ');
                    const fullCommand = `source /opt/ros/humble/setup.bash && source ${shellQuote(robotWorkspaceSetup)} && exec ${commandLine}`;

                    const proc = spawn('bash', ['-c', fullCommand], {
                        detached: true,
                        stdio: 'inherit'
                    });

                    proc.on('error', (err) => {
                        console.error(`[${id}] 启动错误:`, err.message);
                        activeProcesses[id] = null;
                    });

                    proc.on('exit', (code) => {
                        console.log(`[${id}] 已退出 (代码: ${code})`);
                        activeProcesses[id] = null;
                    });

                    activeProcesses[id] = proc;
                } else {
                    console.log(`[${id}] 导航已在运行中，忽略重复启动`);
                }
            }, delay || 0);
        });

        res.json({
            success: true,
            driveType,
            paramsFile,
            message: `导航已启动，底盘: ${driveType === 'diff' ? '差速轮' : '麦克纳姆轮（全向轮）'}，地图: ${mapYaml}`
        });
    } catch (error) {
        console.error('[start_navigation] 启动失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 停止当前目标，保留地图、定位和导航节点。
app.post('/api/cancel_navigation', (req, res) => {
    const command = [
        'source /opt/ros/humble/setup.bash',
        'source /root/chuyun_ws/install/setup.bash',
        "ros2 topic pub --once /lite_navigation/cancel std_msgs/msg/Empty '{}'"
    ].join(' && ');
    const proc = spawn('bash', ['-lc', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let replied = false;

    const finish = (status, body) => {
        if (replied) return;
        replied = true;
        clearTimeout(timer);
        res.status(status).json(body);
    };

    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('error', (error) => finish(500, { success: false, error: error.message }));
    proc.on('close', (code) => {
        if (code === 0) {
            finish(200, { success: true, message: '当前导航已停止，定位仍在运行' });
        } else {
            finish(502, { success: false, error: stderr.trim() || `停止导航失败，退出码 ${code}` });
        }
    });

    const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        finish(504, { success: false, error: '等待导航节点响应超时' });
    }, 8000);
});

// 关闭导航节点 / 查询导航状态 (复用通用接口)
app.post('/api/stop_navigation', (req, res) => res.redirect(307, '/api/stop_task/navigation'));
app.get('/api/navigation_status', (req, res) => res.redirect(301, '/api/task_status/navigation'));

// 保存地图接口
app.post('/api/save_map', (req, res) => {
    const { mapName } = req.body;
    if (!mapName || mapName.trim() === '') {
        return res.status(400).json({ success: false, error: '地图名称不能为空' });
    }

    const config = loadConfig();
    const saveMapConfig = config.save_map;
    if (!saveMapConfig || !saveMapConfig.command) {
        return res.status(500).json({ success: false, error: 'ros_config.json 中未配置 save_map 命令' });
    }

    const saveDir = saveMapConfig.save_dir || '/tmp';
    const safeName = mapName.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
    const savePath = `${saveDir}/${safeName}`;
    const args = [...saveMapConfig.args, savePath];
    const robotWorkspaceSetup = '/root/chuyun_ws/install/setup.bash';
    const fullCommand = `mkdir -p "${saveDir}" && source /opt/ros/humble/setup.bash && source ${robotWorkspaceSetup} && ${saveMapConfig.command} ${args.join(' ')}`;

    console.log(`[save_map] 正在保存地图到: ${savePath}`);

    const proc = spawn('bash', ['-c', fullCommand], { stdio: 'inherit' });
    proc.on('exit', (code) => {
        if (code === 0) {
            console.log(`[save_map] 保存成功: ${savePath}`);
            res.json({ success: true, message: `地图已保存至 ${savePath}`, path: savePath });
        } else {
            console.error(`[save_map] 保存失败，退出码: ${code}`);
            res.status(500).json({ success: false, error: `保存失败，退出码: ${code}` });
        }
    });
    proc.on('error', (err) => {
        console.error('[save_map] 执行错误:', err.message);
        res.status(500).json({ success: false, error: err.message });
    });
});

// 停止所有活跃进程的函数
function stopAllProcesses() {
    console.log('正在清理所有活跃进程...');
    Object.keys(activeProcesses).forEach((id) => {
        const proc = activeProcesses[id];
        if (proc && proc.pid) {
            try {
                process.kill(-proc.pid);
                console.log(`[${id}] 已停止`);
            } catch (e) {
                if (!e.message.includes('ESRCH')) {
                    console.error(`无法停止 ${id}:`, e.message);
                }
            }
            activeProcesses[id] = null;
        }
    });
}

// 监听进程退出信号
process.on('SIGINT', () => {
    stopAllProcesses();
    process.exit();
});

process.on('SIGTERM', () => {
    stopAllProcesses();
    process.exit();
});

app.listen(port, () => {
    console.log(`ROS 2 运行服务后端已启动并监听在 http://localhost:${port}`);
});
