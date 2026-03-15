// src/tools/executor.ts
// Executes tool calls made by the model
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
function buildDiff(filePath, before, after) {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    let additions = 0;
    let deletions = 0;
    // Simple line-level count (not full Myers diff, but good enough for display)
    const beforeSet = new Set(beforeLines);
    const afterSet = new Set(afterLines);
    for (const l of afterLines)
        if (!beforeSet.has(l))
            additions++;
    for (const l of beforeLines)
        if (!afterSet.has(l))
            deletions++;
    return { path: filePath, before, after, additions, deletions };
}
export class ToolExecutor {
    workingDir;
    sessionFiles = {}; // path -> original content before first edit
    changeHistory = []; // ordered list for undo
    constructor(workingDir) {
        this.workingDir = workingDir;
    }
    async execute(tool) {
        try {
            switch (tool.name) {
                case 'read_file': return this.readFile(tool.args);
                case 'write_file': return this.writeFile(tool.args);
                case 'patch_file': return this.patchFile(tool.args);
                case 'run_shell': return this.runShell(tool.args);
                case 'list_dir': return this.listDir(tool.args);
                case 'git_operation': return this.gitOperation(tool.args);
                default:
                    return { success: false, output: `Unknown tool: ${tool.name}` };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Tool error: ${msg}` };
        }
    }
    resolvePath(p) {
        return path.isAbsolute(p) ? p : path.resolve(this.workingDir, p);
    }
    readFile(args) {
        const abs = this.resolvePath(args.path);
        if (!fs.existsSync(abs)) {
            return { success: false, output: `File not found: ${args.path}` };
        }
        const content = fs.readFileSync(abs, 'utf8');
        return { success: true, output: content };
    }
    writeFile(args) {
        const abs = this.resolvePath(args.path);
        const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        if (!this.sessionFiles[abs])
            this.sessionFiles[abs] = before;
        this.changeHistory.push({ path: abs, before });
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, args.content, 'utf8');
        const diff = buildDiff(abs, before, args.content);
        return { success: true, output: `Written: ${args.path}`, diff };
    }
    patchFile(args) {
        const abs = this.resolvePath(args.path);
        if (!fs.existsSync(abs)) {
            return { success: false, output: `File not found: ${args.path}` };
        }
        const before = fs.readFileSync(abs, 'utf8');
        if (!before.includes(args.old_str)) {
            return { success: false, output: `old_str not found in ${args.path}` };
        }
        if (!this.sessionFiles[abs])
            this.sessionFiles[abs] = before;
        this.changeHistory.push({ path: abs, before });
        const after = before.replace(args.old_str, args.new_str);
        fs.writeFileSync(abs, after, 'utf8');
        const diff = buildDiff(abs, before, after);
        return { success: true, output: `Patched: ${args.path}`, diff };
    }
    async runShell(args) {
        const cwd = args.cwd ? this.resolvePath(args.cwd) : this.workingDir;
        try {
            const { stdout, stderr } = await execAsync(args.command, { cwd, timeout: 30000 });
            const output = [stdout, stderr].filter(Boolean).join('\n').trim();
            return { success: true, output: output || '(no output)' };
        }
        catch (err) {
            const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
            return { success: false, output: output || err.message };
        }
    }
    listDir(args) {
        const abs = this.resolvePath(args.path);
        if (!fs.existsSync(abs)) {
            return { success: false, output: `Path not found: ${args.path}` };
        }
        const walk = (dir, prefix = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const result = [];
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules')
                    continue;
                result.push(`${prefix}${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`);
                if (args.recursive && entry.isDirectory()) {
                    result.push(...walk(path.join(dir, entry.name), prefix + '  '));
                }
            }
            return result;
        };
        return { success: true, output: walk(abs).join('\n') };
    }
    async gitOperation(args) {
        return this.runShell({ command: `git ${args.args}`, cwd: this.workingDir });
    }
    getSessionFiles() {
        return this.sessionFiles;
    }
    undoLastChange() {
        const last = this.changeHistory.pop();
        if (!last)
            return null;
        fs.writeFileSync(last.path, last.before, 'utf8');
        return last.path;
    }
}
//# sourceMappingURL=executor.js.map