import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-linux-4.1.13.9-support.mjs <WMPFDebugger/src/platform/linux.ts>');

const expectedNeedle = 'function searchWmpfVersionInFile(filePath: string): number {';
const source = await readFile(target, 'utf8');
if (!source.includes(expectedNeedle)) {
  throw new Error('WMPF linux.ts marker not found');
}

const replacement = `import { IPlatform, WmpfProcessInfo } from "./types";
import * as frida from "frida"
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function searchWmpfVersionInFile(filePath: string): number {
    const buffer = fs.readFileSync(filePath);
    const binstr = buffer.toString('latin1');
    const regex = /,(?:\\d+\\.){3}(\\d+)\\x00/;
    const match = regex.exec(binstr);
    return match && match[1]
        ? Number(match[1])
        : 0;
}

function searchClientVersionInCmdline(pid: number): number {
    try {
        const cmdline = fs.readFileSync(\`/proc/\${pid}/cmdline\`, "latin1");
        const match = /--client_version=(\\d+)/.exec(cmdline.replace(/\\x00/g, " "));
        return match && match[1] ? Number(match[1]) : 0;
    } catch {
        return 0;
    }
}

function resolveHostPath(pid: number, sandboxPath: string): string | null {
    if (fs.existsSync(sandboxPath)) return sandboxPath;

    const procRootPath = path.join("/proc", String(pid), "root", sandboxPath);
    if (fs.existsSync(procRootPath)) return procRootPath;

    if (sandboxPath.startsWith("/app/")) {
        const relativePath = sandboxPath.slice("/app/".length);
        const flatpakAppRoots = [
            path.join(os.homedir(), ".local/share/flatpak/app"),
            "/var/lib/flatpak/app",
        ];
        for (const flatpakAppRoot of flatpakAppRoots) {
            if (!fs.existsSync(flatpakAppRoot)) continue;
            for (const appId of fs.readdirSync(flatpakAppRoot)) {
                const candidate = path.join(
                    flatpakAppRoot,
                    appId,
                    "current/active/files",
                    relativePath,
                );
                if (fs.existsSync(candidate)) return candidate;
            }
        }
    }

    return null;
}

export class LinuxPlatform implements IPlatform {
    async findWmpfProcess(): Promise<WmpfProcessInfo> {
        const localDevice = await frida.getLocalDevice();
        const processes = await localDevice.enumerateProcesses({
            scope: frida.Scope.Metadata,
        });
        const wmpfProcesses = processes.filter(
            (process) => process.name === "WeChatAppEx",
        );
        if (wmpfProcesses.length === 0) {
            throw new Error("[frida] WeChatAppEx process not found");
        }

        const wmpfPids = new Set(wmpfProcesses.map((p) => p.pid));
        const wmpfProcess = wmpfProcesses.find((p) => {
            const ppid = p.parameters.ppid ? Number(p.parameters.ppid) : 0;
            return ppid !== 0 && !wmpfPids.has(ppid);
        });
        if (wmpfProcess === undefined) {
            throw new Error("[frida] WeChatAppEx root process not found");
        }

        const wmpfPid = Number(wmpfProcess.pid);
        const wmpfProcessPath = wmpfProcess.parameters.path as string | undefined;
        const hostPath =
            wmpfProcessPath && wmpfPid !== 0
                ? resolveHostPath(wmpfPid, wmpfProcessPath)
                : null;

        let wmpfVersion =
            hostPath !== null ? searchWmpfVersionInFile(hostPath) : 0;
        if (wmpfVersion === 0) {
            wmpfVersion = searchClientVersionInCmdline(wmpfPid);
        }
        if (wmpfVersion === 0) {
            throw new Error(
                \`[frida] error in find wmpf version (process path: \${hostPath ?? wmpfProcessPath})\`,
            );
        }
        return { pid: wmpfPid, version: wmpfVersion };
    }
}
`;

await writeFile(target, replacement, 'utf8');

const wmpfRoot = dirname(dirname(dirname(target)));
const configPath = join(wmpfRoot, 'frida', 'config', 'linux', 'addresses.4067695881.json');
await mkdir(dirname(configPath), {recursive: true});
await writeFile(configPath, JSON.stringify({
  Version: 4067695881,
  LoadStartHookOffset: '0x900eee0',
  CDPFilterHookOffset: '0xdc1c670',
  SceneOffsets: [56, 1528, 8, 1464, 16, 456],
}, null, 4) + '\n', 'utf8');

console.log('Applied Linux WMPF 4067695881 support (upstream PR #272 compatibility overlay)');
