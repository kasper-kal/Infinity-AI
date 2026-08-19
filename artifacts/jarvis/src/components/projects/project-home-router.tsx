"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ProjectHome, type ProjectHomeAction } from './project-home';
import { ProjectHomeBook } from '@/components/views/projects/ProjectHomeBook';
import { ProjectHomeWebsite } from '@/components/views/projects/ProjectHomeWebsite';
import { ProjectHomeCompany } from '@/components/views/projects/ProjectHomeCompany';
import { ProjectHomeApp } from '@/components/views/projects/ProjectHomeApp';
import { ProjectHomeResearch } from '@/components/views/projects/ProjectHomeResearch';
import { ProjectHomeCourse } from '@/components/views/projects/ProjectHomeCourse';

interface ProjectHomeRouterProps {
  projectId: string;
  onBack: () => void;
  onContinueConversation: (conversationId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onOpenAction?: (action: ProjectHomeAction) => void;
  projectType?: string;
}

export function ProjectHomeRouter({
  projectId,
  onBack,
  onContinueConversation,
  onNewChat,
  onOpenAction,
  projectType = 'general',
}: ProjectHomeRouterProps) {
  const [type, setType] = useState<string>(projectType);

  // Fetch the actual project type if not provided
  useEffect(() => {
    if (projectType === 'general') {
      fetch(`/api/jarvis/projects/${encodeURIComponent(projectId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.type) setType(data.type);
        })
        .catch(() => {});
    }
  }, [projectId, projectType]);

  const renderProjectHome = () => {
    switch (type) {
      case 'book':
        return (
          <ProjectHomeBook
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
      case 'website':
        return (
          <ProjectHomeWebsite
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
      case 'company':
        return (
          <ProjectHomeCompany
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
      case 'app':
        return (
          <ProjectHomeApp
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
      case 'research':
        return (
          <ProjectHomeResearch
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
      case 'course':
        return (
          <ProjectHomeCourse
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
      default:
        return (
          <ProjectHome
            projectId={projectId}
            onBack={onBack}
            onContinueConversation={onContinueConversation}
            onNewChat={onNewChat}
            onOpenAction={onOpenAction}
          />
        );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4 sm:px-6 lg:px-10 lg:pt-7">
        {renderProjectHome()}
      </div>
    </div>
  );
}

export default ProjectHomeRouter;