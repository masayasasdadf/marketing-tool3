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
    <div className="bg-white border-b border-gray-200 px-2 sm:px-4 overflow-x-auto">
      <nav className="flex gap-1 sm:gap-6 min-w-max">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`py-2.5 sm:py-3 px-2 sm:px-1 text-xs sm:text-sm whitespace-nowrap transition-colors ${
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
