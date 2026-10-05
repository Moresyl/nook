import { useEffect, useRef } from 'react';
import type { Project } from '../../contracts/workspace';
import { Button, IconButton } from './controls';
import { Glyph } from './glyphs';

type Props = { projects: Project[]; selectedId: string; onSelect: (id: string) => void; onEdit: (project: Project) => void; onAdd: () => void };
export function ProjectSwitcher({ projects, selectedId, onSelect, onEdit, onAdd }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const projectOrder = JSON.stringify(projects.map(project => project.id));
  useEffect(() => {
    const viewport = list.current; if (!viewport) return;
    const selected = viewport.querySelector<HTMLElement>('.selected');
    const reveal = () => {
      const focused = document.activeElement?.closest<HTMLElement>('.project-row');
      const target = focused && viewport.contains(focused) ? focused : selected;
      if (!target || !viewport.clientWidth) return;
      const bounds = viewport.getBoundingClientRect(); const row = target.getBoundingClientRect();
      const left = bounds.left + 2; const right = bounds.right - 2;
      const delta = row.left < left ? row.left - left : Math.max(0, row.right - right);
      if (delta) viewport.scrollBy({ left: delta, behavior: 'instant' });
    };
    reveal();
    const observer = new ResizeObserver(reveal); observer.observe(viewport);
    if (selected) observer.observe(selected);
    return () => observer.disconnect();
  }, [selectedId, projectOrder]);
  return <div className="project-list">
    <IconButton className="icon-button project-list-add" icon="plus" label="添加项目" onClick={onAdd} />
    <div className="project-tabs" ref={list}>
      {projects.map(project => <div key={project.id} className={`project-row ${selectedId === project.id ? 'selected' : ''}`}>
        <Button aria-pressed={selectedId === project.id} title={project.name} onClick={() => onSelect(project.id)}><Glyph name="folder" /><span>{project.name}</span></Button>
        <IconButton icon="settings" label={`编辑 ${project.name}`} onClick={() => onEdit(project)} />
      </div>)}
    </div>
  </div>;
}
