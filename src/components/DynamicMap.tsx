"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type MapViewComponent from "./MapView";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="spinner mx-auto mb-2"></div>
        <p className="text-sm text-gray-500">地図を読み込み中...</p>
      </div>
    </div>
  ),
});

export default function DynamicMap(props: ComponentProps<typeof MapViewComponent>) {
  return <MapView {...props} />;
}
