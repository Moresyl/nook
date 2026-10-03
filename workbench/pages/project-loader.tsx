import { lazy, Suspense, type ComponentProps } from 'react';
const ProjectsPage = lazy(() => import('./projects').then((module) => ({ default: module.Projects })));
export function Projects(props: ComponentProps<typeof ProjectsPage>) {
  return <Suspense fallback={<div className="collection-page"><p className="muted">正在打开项目…</p></div>}><ProjectsPage {...props} /></Suspense>;
}
