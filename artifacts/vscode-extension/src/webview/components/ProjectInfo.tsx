import React from 'react';

interface ProjectInfoProps {
  project: any;
  projectRoot: string;
}

export function ProjectInfo({ project, projectRoot }: ProjectInfoProps) {
  if (!project) {
    return (
      <div className="project-info no-project">
        <div className="project-header">
          <span className="project-icon">∞</span>
          <div>
            <h3>No Project Selected</h3>
            <p>Select a project from the toolbar or configure Project ID in settings</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="project-info">
      <div className="project-header">
        <span className="project-icon">∞</span>
        <div className="project-details">
          <h3>{project.name}</h3>
          <p className="project-id">{project.id}</p>
        </div>
      </div>
      <div className="project-meta">
        <div className="meta-item">
          <span className="meta-label">Type:</span>
          <span className="meta-value">{project.type || 'Unknown'}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Framework:</span>
          <span className="meta-value">{project.framework || 'Not detected'}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Root:</span>
          <span className="meta-value path">{projectRoot}</span>
        </div>
        {project.lastBuild && (
          <div className="meta-item">
            <span className="meta-label">Last Build:</span>
            <span className="meta-value">{new Date(project.lastBuild).toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}