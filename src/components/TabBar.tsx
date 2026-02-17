"use client";

type TabName = "map" | "rankings" | "changes" | "day-night" | "huff";

interface TabBarProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

const TABS: { id: TabName; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "rankings", label: "Rankings" },
  { id: "changes", label: "Changes" },
  { id: "day-night", label: "Day-Night" },
  { id: "huff", label: "Huff" },
];

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-4">
      <nav className="flex gap-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`py-3 px-1 text-sm transition-colors ${
              activeTab === tab.id ? "tab-active" : "tab-inactive"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
