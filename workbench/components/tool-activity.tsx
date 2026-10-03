import type { ToolActivity } from '../../contracts/tools';
import { Glyph } from './glyphs';

const labels: Record<string, string> = { list_files: '查看项目文件', read_file: '读取文件', search_files: '搜索项目', git_diff: '查看 Git 改动', write_file: '保存文件', edit_file: '修改文件', run_command: '执行命令', load_skill: '读取技能说明', read_skill_file: '读取技能文件' };
const statuses = { waiting: '等待审批', running: '执行中', complete: '已完成', error: '失败', stopped: '已停止' };
export function ToolActivities({ activities }: { activities: ToolActivity[] }) {
  return <div className="tool-activities" aria-label="工具执行记录">{activities.map((activity) => <details className={`tool-activity tool-${activity.status}`} key={activity.id}>
    <summary><Glyph name="code" size={16} /><span>{activity.displayName ?? labels[activity.name] ?? activity.name}</span><span className="tool-status">{statuses[activity.status]}</span></summary>
    <div className="tool-detail"><p className="field-hint">输入</p><pre>{activity.input}</pre>{activity.output && <><p className="field-hint">结果</p><pre>{activity.output}</pre></>}</div>
  </details>)}</div>;
}
