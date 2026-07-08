import { describe, it, expect } from "vitest";
import { useApp } from "../store";

describe("Background Workers Zustand Store Integration", () => {
  it("enqueues jobs to backgroundJobs list", () => {
    const originalState = useApp.getState().backgroundJobs;
    useApp.setState({ backgroundJobs: [] });

    try {
      const jobId = useApp.getState().enqueueJob("refresh-blueprint", { test: true }, { priority: "high" });
      expect(jobId).toBeDefined();
      expect(useApp.getState().backgroundJobs).toHaveLength(1);

      const job = useApp.getState().backgroundJobs[0];
      expect(job.type).toBe("refresh-blueprint");
      expect(job.priority).toBe("high");
      expect(job.status).toBe("queued");
      expect(job.payload.test).toBe(true);
    } finally {
      useApp.setState({ backgroundJobs: originalState });
    }
  });

  it("processes enqueued jobs when runWorkerQueue is called", async () => {
    const originalState = useApp.getState().backgroundJobs;
    useApp.setState({ backgroundJobs: [] });

    try {
      useApp.getState().enqueueJob("health-check", { check: true });
      expect(useApp.getState().backgroundJobs[0].status).toBe("queued");

      const runPromise = useApp.getState().runWorkerQueue();
      
      // Since it simulates processing, let's verify that the status is set to running
      expect(useApp.getState().backgroundJobs[0].status).toBe("running");

      await runPromise;

      // After runWorkerQueue resolves, it should be either success or failed
      const status = useApp.getState().backgroundJobs[0].status;
      expect(["success", "failed"]).toContain(status);
    } finally {
      useApp.setState({ backgroundJobs: originalState });
    }
  });

  it("clears job history when clearJobHistory is called", () => {
    const originalState = useApp.getState().backgroundJobs;
    useApp.setState({ backgroundJobs: [] });

    try {
      useApp.getState().enqueueJob("optimize", { id: "1" });
      expect(useApp.getState().backgroundJobs).toHaveLength(1);

      useApp.getState().clearJobHistory();
      expect(useApp.getState().backgroundJobs).toHaveLength(0);
    } finally {
      useApp.setState({ backgroundJobs: originalState });
    }
  });
});
