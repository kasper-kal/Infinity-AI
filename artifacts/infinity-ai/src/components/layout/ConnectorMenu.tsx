/**
 * Connector Menu — Liquid Glass Design System
 * Integration cards for external services (Spotify, Google Calendar, Gmail, Slack, GitHub, Figma)
 */

import React, { useState, useCallback } from "react";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";

interface Connector {
  id: string;
  name: string;
  descKey: TranslationKey;
  icon: React.ReactNode;
  color: string;
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const CONNECTORS: Connector[] = [
  {
    id: "spotify",
    name: "Spotify",
    descKey: "connectors.spotifyDesc",
    color: "#1DB954",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.88-1.92-4.8-4.92-4.8-8.52 0-.479.36-.84.84-.84.42 0 .78.301.84.72C16.197 12.538 18 15.657 18 19.078c0 .42.36.72.78.72.48 0 .84-.42.84-.899v-.84z"/>
      </svg>
    ),
    connected: false,
    onConnect: () => console.log("Connect Spotify"),
    onDisconnect: () => console.log("Disconnect Spotify"),
  },
  {
    id: "googleCalendar",
    name: "Google Calendar",
    descKey: "connectors.googleCalendarDesc",
    color: "#4285F4",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/>
      </svg>
    ),
    connected: false,
    onConnect: () => console.log("Connect Google Calendar"),
    onDisconnect: () => console.log("Disconnect Google Calendar"),
  },
  {
    id: "gmail",
    name: "Gmail",
    descKey: "connectors.gmailDesc",
    color: "#EA4335",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
      </svg>
    ),
    connected: false,
    onConnect: () => console.log("Connect Gmail"),
    onDisconnect: () => console.log("Disconnect Gmail"),
  },
  {
    id: "slack",
    name: "Slack",
    descKey: "connectors.slackDesc",
    color: "#4A154B",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.522 2.37 7.851 7.303c-1.209 1.057-.983 2.782.268 3.644l3.561 2.423a.501.501 0 0 1 .119.565l-2.52 5.467c-.228.495.226 1.053.65.993l3.723-.532a4.356 4.356 0 0 0 1.404.119c.193 0 .38-.031.554-.088l4.05 3.037c.51.382 1.119.037 1.076-.56l-.038-.512L14.08 12.22c-.044-.562.518-.982.868-.74l2.307 1.626c.494.348 1.089-.062 1.006-.618l-.093-.634-2.266-5.467a.5.5 0 0 1-.077-.625l2.933-2.753c.395-.371.271-.972-.19-1.231l-4.533-2.552a4.35 4.35 0 0 0-1.418-.119c-.236 0-.459.054-.654.145l-4.11-2.315c-.556-.313-1.213-.06-1.192.568l.02.562 2.636 5.533a.5.5 0 0 1-.093.647l-3.852 3.273c-.396.337-.952-.017-1.006-.618L11.346 6.71a4.38 4.38 0 0 0-1.272-.537c-.19 0-.37.031-.538.085l-3.65-2.472c-.423-.286-.947.166-.88.554l.06.373 5.67 4.927a4.34 4.34 0 0 0 1.415.12c.233 0 .456-.054.65-.144L22.12 20.31c.399.224.903-.152.92-.527l.02-.422-1.932-5.273a.5.5 0 0 1 .12-.565l3.614-2.758c.424-.324.144-.883-.36-.883a4.312 4.312 0 0 0-1.407-.12l-4.015 3.058c-.406.31-.897.036-.87-.533l.025-.506 2.459-5.442c.275-.61-.092-1.234-.66-1.234a4.344 4.344 0 0 0-1.356.106L13.522 2.37Z"/>
      </svg>
    ),
    connected: false,
    onConnect: () => console.log("Connect Slack"),
    onDisconnect: () => console.log("Disconnect Slack"),
  },
  {
    id: "github",
    name: "GitHub",
    descKey: "connectors.githubDesc",
    color: "#24292E",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.305-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
      </svg>
    ),
    connected: false,
    onConnect: () => console.log("Connect GitHub"),
    onDisconnect: () => console.log("Disconnect GitHub"),
  },
  {
    id: "figma",
    name: "Figma",
    descKey: "connectors.figmaDesc",
    color: "#F24E1E",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.707 9.95c-.257-.086-.522-.112-.78-.077L12.977 14.85c-.26.036-.505.132-.717.28l-1.295.875-.051-.043c-.009 0-.017-.001-.026-.003-.214-.034-.42-.08-.624-.124l-1.737-1.174c-.214-.144-.498-.17-.703-.075l-.474.217c-.26.119-.45.394-.475.687l-.366 4.384c-.024.285.124.55.354.655.233.105.503.14.77.096.27-.044.52-.143.718-.287l.104-.075 5.388-3.638c.193-.13.36-.312.487-.523l2.436-4.042c.212-.352.07-.748-.31-.91l-.052-.022c-.256-.116-.532-.125-.79-.085-.348.054-.62.254-.79.522l-1.983 3.29-3.664-2.473-.222-.15c-.303-.205-.663-.203-.93.005-.267.208-.397.512-.354.793l.395 2.67c.036.24.206.456.432.544l4.208 1.558c.226.084.471.102.704.06.237-.042.432-.195.53-.393L21.707 9.95ZM9.254 14.66 11.39 12.52l4.678 3.16c.073.05.119.131.141.217l-.191.715-4.839-3.272c-.2-.135-.386-.29-.538-.442l-.001-.001Zm11.278-.382 1.126 3.524-3.908 1.851-1.126-3.524 3.908-1.851Z"/>
      </svg>
    ),
    connected: false,
    onConnect: () => console.log("Connect Figma"),
    onDisconnect: () => console.log("Disconnect Figma"),
  },
];

interface ConnectorMenuProps {
  /** Optional callback when connector state changes */
  onConnectorChange?: (connectorId: string, connected: boolean) => void;
  /** Custom class name */
  className?: string;
}

export const ConnectorMenu: React.FC<ConnectorMenuProps> = ({
  onConnectorChange,
  className = "",
}) => {
  const { t } = useI18n();
  const [connectors, setConnectors] = useState(CONNECTORS);
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleConnect = useCallback((connectorId: string) => {
    setConnectors((prev) =>
      prev.map((c) =>
        c.id === connectorId ? { ...c, connected: true } : c
      )
    );
    onConnectorChange?.(connectorId, true);
  }, [onConnectorChange]);

  const handleDisconnect = useCallback((connectorId: string) => {
    setConnectors((prev) =>
      prev.map((c) =>
        c.id === connectorId ? { ...c, connected: false } : c
      )
    );
    onConnectorChange?.(connectorId, false);
  }, [onConnectorChange]);

  const handleExpand = useCallback((connectorId: string) => {
    setExpanded((prev) => (prev === connectorId ? null : connectorId));
  }, []);

  return (
    <section className={`sidebar-section ${className}`}>
      <header className="sidebar-section__header">
        <h2 className="sidebar-section__title">{t("connectors.title")}</h2>
        <span className="sidebar-section__chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </header>
      <div className="sidebar-section__content">
        <p className="text-xs text-muted-foreground mb-4">{t("connectors.subtitle")}</p>
        <div className="space-y-3">
          {connectors.map((connector) => {
            const isExpanded = expanded === connector.id;
            return (
              <div
                key={connector.id}
                className={`connector-card ${connector.connected ? "connected" : ""} ${isExpanded ? "expanded" : ""}`}
                style={{ "--connector-color": connector.color } as React.CSSProperties}
              >
                <div className="connector-card__main" onClick={() => handleExpand(connector.id)}>
                  <div className="connector-card__icon" style={{ backgroundColor: connector.color }}>
                    {connector.icon}
                  </div>
                  <div className="connector-card__info">
                    <h3 className="connector-card__name">{connector.name}</h3>
                    <p className="connector-card__desc">{t(connector.descKey)}</p>
                  </div>
                  <div className="connector-card__action">
                    {connector.connected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDisconnect(connector.id);
                        }}
                        className="connector-card__btn"
                      >
                        {t("connectors.disconnect")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConnect(connector.id);
                        }}
                        className="connector-card__btn"
                      >
                        {t("connectors.connect")}
                      </Button>
                    )}
                  </div>
                  <span className="connector-card__chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </span>
                </div>
                {isExpanded && (
                  <div className="connector-card__details">
                    <div className="connector-card__status">
                      <span className={`connector-card__status-indicator ${connector.connected ? "connected" : ""}`} />
                      <span className="connector-card__status-text">
                        {connector.connected ? t("connectors.connected") : t("connectors.connect")}
                      </span>
                    </div>
                    <div className="connector-card__features">
                      <p className="text-xs text-muted-foreground">
                        {t(connector.descKey as TranslationKey)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ConnectorMenu;