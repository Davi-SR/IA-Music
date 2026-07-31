import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { phaseFromStatus, presentError } from "./jobPresentation";

describe("job presentation", () => {
  it("maps the backend lifecycle without changing its meaning", () => {
    expect(phaseFromStatus("queued")).toBe("queued");
    expect(phaseFromStatus("processing")).toBe("processing");
    expect(phaseFromStatus("packaging")).toBe("packaging");
    expect(phaseFromStatus("completed")).toBe("completed");
    expect(phaseFromStatus("failed")).toBe("failed");
  });

  it("preserves API diagnostics in a user-friendly error", () => {
    const error = new ApiError("Arquivo recusado", {
      kind: "http",
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      retryable: false,
    });
    expect(presentError(error, "upload")).toMatchObject({
      title: "O arquivo não foi aceito",
      message: "Arquivo recusado",
      retryable: false,
    });
    expect(presentError(error, "upload").details).toContain("HTTP 415");
  });
});
