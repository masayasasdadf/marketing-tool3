"use client";

import { useState } from "react";
import type { Store } from "@/types";

interface StorePanelProps {
  stores: Store[];
  onAdd: (store: Omit<Store, "id" | "attractiveness">) => void;
  onDelete: (id: string) => void;
  center: { lat: number; lng: number } | null;
}

export default function StorePanel({ stores, onAdd, onDelete, center }: StorePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    storeType: "自社" as "自社" | "競合",
    areaSqm: "",
    parkingSpaces: "",
    mainRoad: "no" as "yes" | "no",
    visibility: "中" as "高" | "中" | "低",
    businessHours: "普" as "長" | "普" | "短",
    rating: "",
    reviews: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !center) return;

    onAdd({
      name: form.name,
      lat: center.lat,
      lng: center.lng,
      storeType: form.storeType,
      areaSqm: form.areaSqm ? parseFloat(form.areaSqm) : null,
      parkingSpaces: form.parkingSpaces ? parseInt(form.parkingSpaces, 10) : null,
      mainRoad: form.mainRoad,
      visibility: form.visibility,
      businessHours: form.businessHours,
      rating: form.rating ? parseFloat(form.rating) : null,
      reviews: form.reviews ? parseInt(form.reviews, 10) : null,
    });

    setForm({
      name: "",
      storeType: "自社",
      areaSqm: "",
      parkingSpaces: "",
      mainRoad: "no",
      visibility: "中",
      businessHours: "普",
      rating: "",
      reviews: "",
    });
    setIsOpen(false);
  };

  return (
    <div className="bg-white border-t border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <span>店舗登録 ({stores.length}件)</span>
        <span className="text-gray-400">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="p-4 pt-0">
          {/* Store list */}
          {stores.length > 0 && (
            <div className="mb-3 max-h-40 overflow-y-auto">
              {stores.map((store) => (
                <div
                  key={store.id}
                  className="flex items-center justify-between py-1.5 border-b border-gray-100 text-sm"
                >
                  <div>
                    <span
                      className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                        store.storeType === "自社" ? "bg-blue-600" : "bg-red-500"
                      }`}
                    ></span>
                    <span className="font-medium">{store.name}</span>
                    <span className="text-gray-400 ml-1.5 text-xs">
                      魅力度:{store.attractiveness ?? "-"}
                    </span>
                  </div>
                  <button
                    onClick={() => onDelete(store.id)}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add store form */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="text-xs font-medium text-gray-600">新規店舗（中心点の座標に登録）</div>

            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="店舗名"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              required
            />

            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.storeType}
                onChange={(e) =>
                  setForm({ ...form, storeType: e.target.value as "自社" | "競合" })
                }
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="自社">自社</option>
                <option value="競合">競合</option>
              </select>

              <select
                value={form.mainRoad}
                onChange={(e) =>
                  setForm({ ...form, mainRoad: e.target.value as "yes" | "no" })
                }
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="yes">幹線道路沿い</option>
                <option value="no">幹線道路沿いでない</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={form.areaSqm}
                onChange={(e) => setForm({ ...form, areaSqm: e.target.value })}
                placeholder="面積(㎡)"
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
              <input
                type="number"
                value={form.parkingSpaces}
                onChange={(e) => setForm({ ...form, parkingSpaces: e.target.value })}
                placeholder="駐車場台数"
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <select
                value={form.visibility}
                onChange={(e) =>
                  setForm({ ...form, visibility: e.target.value as "高" | "中" | "低" })
                }
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="高">視認性:高</option>
                <option value="中">視認性:中</option>
                <option value="低">視認性:低</option>
              </select>

              <select
                value={form.businessHours}
                onChange={(e) =>
                  setForm({ ...form, businessHours: e.target.value as "長" | "普" | "短" })
                }
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="長">営業:長</option>
                <option value="普">営業:普</option>
                <option value="短">営業:短</option>
              </select>

              <input
                type="number"
                step="0.1"
                min="0"
                max="5"
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: e.target.value })}
                placeholder="評価"
                className="px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>

            <input
              type="number"
              value={form.reviews}
              onChange={(e) => setForm({ ...form, reviews: e.target.value })}
              placeholder="口コミ数"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            />

            <button
              type="submit"
              disabled={!form.name || !center}
              className="w-full py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              登録
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
