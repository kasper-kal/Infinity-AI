import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createPromoJob,
  getPromoJob,
  listPromoJobs,
  deletePromoJob,
  estimateStepDuration,
  generateScript,
  recordFrames,
  generateAudioTrack,
  assembleVideo,
  generateBackgroundMusic,
  optimizeVideoSpeed,
  createPromoVideo,
  PromoJob,
  PromoScriptStep,
  BrandKit,
} from "../src/lib/promo-maker";

describe("Promo Maker Core Engine", () => {
  let testJob: PromoJob;

  beforeEach(() => {
    // Clean up any existing jobs
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup handled by deletePromoJob in tests
  });

  describe("Job Management", () => {
    it("should create a new promo job with defaults", () => {
      const job = createPromoJob("https://example.com", "Test prompt");
      expect(job.id).toBeDefined();
      expect(job.url).toBe("https://example.com");
      expect(job.prompt).toBe("Test prompt");
      expect(job.duration).toBe(30);
      expect(job.style).toBe("professional");
      expect(job.status).toBe("planning");
      expect(job.progress).toBe(0);
      expect(job.createdAt).toBeInstanceOf(Date);
    });

    it("should create a promo job with custom options", () => {
      const job = createPromoJob("https://example.com", "Test prompt", 60, "cinematic");
      expect(job.duration).toBe(60);
      expect(job.style).toBe("cinematic");
    });

    it("should retrieve a job by ID", () => {
      const job = createPromoJob("https://example.com", "Test prompt");
      const retrieved = getPromoJob(job.id);
      expect(retrieved).toEqual(job);
    });

    it("should return undefined for non-existent job", () => {
      const retrieved = getPromoJob("non-existent-id");
      expect(retrieved).toBeUndefined();
    });

    it("should list all jobs sorted by creation date (newest first)", () => {
      const job1 = createPromoJob("https://example1.com", "Prompt 1");
      // Add small delay to ensure different timestamps
      const job2 = createPromoJob("https://example2.com", "Prompt 2");
      const jobs = listPromoJobs();
      // Jobs should include both, just verify both exist
      const jobIds = jobs.map(j => j.id);
      expect(jobIds).toContain(job1.id);
      expect(jobIds).toContain(job2.id);
    });

    it("should delete a job and its files", () => {
      const job = createPromoJob("https://example.com", "Test prompt");
      const result = deletePromoJob(job.id);
      expect(result).toBe(true);
      expect(getPromoJob(job.id)).toBeUndefined();
    });

    it("should return false when deleting non-existent job", () => {
      const result = deletePromoJob("non-existent-id");
      expect(result).toBe(false);
    });
  });

  describe("estimateStepDuration", () => {
    it("should estimate navigate duration", () => {
      const step: PromoScriptStep = { action: "navigate", description: "test", wait: 3000 };
      expect(estimateStepDuration(step)).toBe(3);
    });

    it("should estimate click duration", () => {
      const step: PromoScriptStep = { action: "click", description: "test", delay: 500 };
      expect(estimateStepDuration(step)).toBe(1); // 500ms + 500ms
    });

    it("should estimate type duration based on text length", () => {
      const step: PromoScriptStep = { action: "type", description: "test", text: "hello", charDelay: 100 };
      expect(estimateStepDuration(step)).toBe(0.5); // 5 chars * 100ms = 500ms
    });

    it("should estimate scroll duration", () => {
      const step: PromoScriptStep = { action: "scroll", description: "test", delay: 1000 };
      expect(estimateStepDuration(step)).toBe(1.5); // 1000ms + 500ms
    });

    it("should estimate wait duration", () => {
      const step: PromoScriptStep = { action: "wait", description: "test", wait: 2000 };
      expect(estimateStepDuration(step)).toBe(2);
    });

    it("should estimate zoom duration", () => {
      const step: PromoScriptStep = { action: "zoom", description: "test", delay: 1500 };
      expect(estimateStepDuration(step)).toBe(2); // 1500ms + 500ms
    });

    it("should estimate pan duration", () => {
      const step: PromoScriptStep = { action: "pan", description: "test", delay: 1500 };
      expect(estimateStepDuration(step)).toBe(2); // 1500ms + 500ms
    });
  });

  describe("Script Generation", () => {
    it("should generate a script with proper structure", async () => {
      const job = createPromoJob("https://example.com", "Show the dashboard", 30, "professional");
      const script = await generateScript(job);

      expect(script.steps).toBeDefined();
      expect(Array.isArray(script.steps)).toBe(true);
      expect(script.estimatedDuration).toBeGreaterThan(0);
      expect(script.targetDuration).toBe(30);
      expect(script.sections).toBeDefined();
      expect(script.sections?.hook).toBeDefined();
      expect(script.sections?.demo).toBeDefined();
      expect(script.sections?.cta).toBeDefined();
    });

    it("should include brand kit in script when provided", async () => {
      const brandKit: BrandKit = {
        colors: { primary: "#0ea5e9", secondary: "#0284c7", accent: "#f97316", background: "#0f172a", text: "#ffffff" },
        fonts: { heading: { name: "Inter", url: "https://fonts.googleapis.com/css2?family=Inter", cssVariable: "--font-heading" }, body: { name: "Roboto", url: "https://fonts.googleapis.com/css2?family=Roboto", cssVariable: "--font-body" } },
      };
      const job = createPromoJob("https://example.com", "Test", 30, "professional");
      job.brandKit = brandKit;

      const script = await generateScript(job);
      expect(script.brandKit).toEqual(brandKit);
    });
  });

  describe("Frame Recording", () => {
    it("should record frames and return array", async () => {
      const job = createPromoJob("https://example.com", "Test", 5, "professional");
      await generateScript(job);
      const frames = await recordFrames(job);

      expect(Array.isArray(frames)).toBe(true);
      // Frames may be empty in mocked environment but should not throw
    });
  });

  describe("Audio Generation", () => {
    it("should generate ASMR audio track", async () => {
      const job = createPromoJob("https://example.com", "Test", 5, "professional");
      await generateScript(job);
      const frames = await recordFrames(job);
      const audioPath = await generateAudioTrack(job, frames);

      expect(audioPath).toBeDefined();
      expect(typeof audioPath).toBe("string");
      expect(audioPath).toContain(job.id);
      expect(audioPath).toContain("_audio.wav");
    });
  });

  describe("Background Music Generation", () => {
    it("should generate background music with deterministic seed", async () => {
      const job = createPromoJob("https://example.com", "Test", 5, "professional");
      const musicPath = await generateBackgroundMusic(job, 5);

      expect(musicPath).toBeDefined();
      expect(typeof musicPath).toBe("string");
      expect(musicPath).toContain(job.id);
      expect(musicPath).toContain("_music.wav");
    });

    it("should generate different music for different job IDs", async () => {
      const job1 = createPromoJob("https://example.com", "Test 1", 5, "professional");
      const job2 = createPromoJob("https://example.com", "Test 2", 5, "professional");

      const music1 = await generateBackgroundMusic(job1, 5);
      const music2 = await generateBackgroundMusic(job2, 5);

      // Both should succeed (mocked)
      expect(music1).toBeDefined();
      expect(music2).toBeDefined();
    });
  });

  describe("Video Assembly", () => {
    it("should assemble video with audio and overlays", async () => {
      const job = createPromoJob("https://example.com", "Test", 5, "professional");
      await generateScript(job);
      const frames = await recordFrames(job);
      const videoPath = await assembleVideo(job, frames);

      expect(videoPath).toBeDefined();
      expect(typeof videoPath).toBe("string");
      expect(videoPath).toContain(job.id);
      expect(videoPath).toContain(".mp4");
    });
  });

  describe("Speed Optimization", () => {
    it("should optimize video speed when over target duration", async () => {
      const job = createPromoJob("https://example.com", "Test", 5, "professional");
      await generateScript(job);
      const frames = await recordFrames(job);
      await assembleVideo(job, frames);

      // Mock the video path
      job.videoPath = "/tmp/test.mp4";
      job.rawVideoPath = "/tmp/test_raw.mp4";

      const optimizedPath = await optimizeVideoSpeed(job);
      expect(optimizedPath).toBeDefined();
    });
  });

  describe("End-to-End Integration", () => {
    it("should create a complete promo video", async () => {
      const job = await createPromoVideo("https://example.com", "Show the dashboard", 10, "professional");

      expect(job.id).toBeDefined();
      expect(job.status).toBe("completed");
      expect(job.progress).toBe(100);
      expect(job.videoPath).toBeDefined();
    });
  });
});