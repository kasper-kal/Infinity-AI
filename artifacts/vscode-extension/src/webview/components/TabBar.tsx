import React from 'react';

interface TabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

interface TabProps {
  id: string;
  label: string;
  icon: string;
  children: React.ReactNode;
}

export function TabBar({ activeTab, onTabChange, children }: TabBarProps) {
  const tabs = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<TabProps> => React.isValidElement(child)
  );

  return (
    <div className="tab-bar">
      <div className="tab-headers" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.props.id}
            role="tab"
            aria-selected={activeTab === tab.props.id}
            className={`tab-header ${activeTab === tab.props.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.props.id)}
          >
            <span className="tab-icon">{tab.props.icon}</span>
            <span className="tab-label">{tab.props.label}</span>
          </button>
        ))}
      </div>
      <div className="tab-panels" role="tabpanel">
        {tabs.map((tab) =>
          activeTab === tab.props.id ? (
            <div key={tab.props.id} className="tab-panel">
              {tab.props.children}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

export function Tab({ id, label, icon, children }: TabProps) {
  return <div data-tab-id={id} data-tab-label={label} data-tab-icon={icon}>{children}</div>;
}