import { useRef, useCallback } from 'react';

export function useAudioRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const startRecording = useCallback(async () => {
    // #23: Stop any existing stream/recorder before starting a new one to prevent orphaned mic streams
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      } catch { /* noop */ }
      mediaRecorderRef.current = null;
    }

    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    let mimeType = '';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    }

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
  }, []);

  const stopRecording = useCallback((): Promise<{blob: Blob, mimeType: string}> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        return reject(new Error("No recorder initialized"));
      }

      if (recorder.state === 'inactive') {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        return resolve({ blob, mimeType: recorder.mimeType });
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        recorder.stream.getTracks().forEach(t => t.stop());
        resolve({ blob, mimeType: recorder.mimeType });
      };
      recorder.stop();
    });
  }, []);

  return { startRecording, stopRecording };
}
