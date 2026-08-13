"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { Topbar } from "@/components/layout/topbar";

/** Renders the OpenAPI spec (served at /api/openapi.json) via
 *  Scalar. The docs are session-authenticated — sit inside the
 *  `(app)` layout — but the underlying JSON is scope-reachable so
 *  a programmatic consumer can fetch it with an ops key. */
export default function ApiDocsPage() {
  return (
    <div className="h-full flex flex-col">
      <Topbar title="API docs" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ApiReferenceReact
          configuration={{
            url: "/api/openapi.json",
            hideDownloadButton: false,
            theme: "purple",
            defaultOpenAllTags: true,
          }}
        />
      </div>
    </div>
  );
}
