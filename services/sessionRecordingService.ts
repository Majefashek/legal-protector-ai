import { TranscriptionEntry } from "../types";
import { encodeWAV } from "./audioUtils";

export interface SessionRecording {
	sessionId: string;
	startTime: number;
	endTime: number | null;
	audioChunks: Float32Array[];
	transcript: TranscriptionEntry[];
	location: { lat: number; lng: number } | null;
	sampleRate: number;
}

export interface SessionPackage {
	sessionId: string;
	timestamp: string;
	duration: number;
	location: { lat: number; lng: number } | null;
	transcriptText: string;
	audioBlob: Blob;
	metadataJson: string;
}

class SessionRecordingService {
	private currentSession: SessionRecording | null = null;
	private lastActivityTime: number = Date.now();
	private idleCheckInterval: NodeJS.Timeout | null = null;
	private onIdleCallback: ((sessionPackage: SessionPackage) => void) | null =
		null;

	startRecording(
		location: { lat: number; lng: number } | null,
		sampleRate: number = 16000,
	): string {
		const sessionId = crypto.randomUUID();
		this.currentSession = {
			sessionId,
			startTime: Date.now(),
			endTime: null,
			audioChunks: [],
			transcript: [],
			location,
			sampleRate,
		};
		this.lastActivityTime = Date.now();
		this.startIdleMonitoring();
		console.log("Session recording started:", sessionId);
		return sessionId;
	}

	addAudioChunk(chunk: Float32Array): void {
		if (this.currentSession) {
			this.currentSession.audioChunks.push(new Float32Array(chunk));
			this.updateActivity();
		}
	}

	addTranscriptEntry(entry: TranscriptionEntry): void {
		if (this.currentSession) {
			this.currentSession.transcript.push(entry);
			this.updateActivity();
		}
	}

	updateActivity(): void {
		this.lastActivityTime = Date.now();
	}

	private startIdleMonitoring(): void {
		// Check every 5 seconds for idle timeout
		this.idleCheckInterval = setInterval(() => {
			const idleTime = Date.now() - this.lastActivityTime;
			const IDLE_TIMEOUT = 100000; // 30 seconds

			if (idleTime >= IDLE_TIMEOUT && this.currentSession) {
				console.warn("Session idle for 30s - triggering auto-upload");
				this.stopIdleMonitoring();
				const sessionPackage = this.generateSessionPackage();
				if (sessionPackage && this.onIdleCallback) {
					this.onIdleCallback(sessionPackage);
				}
			}
		}, 5000);
	}

	private stopIdleMonitoring(): void {
		if (this.idleCheckInterval) {
			clearInterval(this.idleCheckInterval);
			this.idleCheckInterval = null;
		}
	}

	setIdleCallback(callback: (sessionPackage: SessionPackage) => void): void {
		this.onIdleCallback = callback;
	}

	stopRecording(): SessionPackage | null {
		this.stopIdleMonitoring();
		if (!this.currentSession) return null;

		this.currentSession.endTime = Date.now();
		const sessionPackage = this.generateSessionPackage();
		this.currentSession = null;
		return sessionPackage;
	}

	private generateSessionPackage(): SessionPackage | null {
		if (!this.currentSession) return null;

		const session = this.currentSession;
		const endTime = session.endTime || Date.now();
		const duration = Math.round((endTime - session.startTime) / 1000);

		// Merge all audio chunks
		const totalLength = session.audioChunks.reduce(
			(acc, chunk) => acc + chunk.length,
			0,
		);
		const mergedAudio = new Float32Array(totalLength);
		let offset = 0;
		for (const chunk of session.audioChunks) {
			mergedAudio.set(chunk, offset);
			offset += chunk.length;
		}

		// Generate WAV blob
		const audioBlob = encodeWAV(mergedAudio, session.sampleRate);

		// Generate transcript text
		const transcriptText = session.transcript
			.map((entry) => {
				const timestamp = new Date(entry.timestamp).toLocaleTimeString();
				const speaker = entry.role === "user" ? "USER" : "AI PROTECTOR";
				return `[${timestamp}] ${speaker}: ${entry.text}`;
			})
			.join("\n\n");

		// Generate metadata JSON
		const metadata = {
			sessionId: session.sessionId,
			startTime: new Date(session.startTime).toISOString(),
			endTime: new Date(endTime).toISOString(),
			duration: `${duration}s`,
			location: session.location,
			transcriptEntries: session.transcript.length,
			audioSamples: totalLength,
			sampleRate: session.sampleRate,
		};

		return {
			sessionId: session.sessionId,
			timestamp: new Date(session.startTime).toISOString(),
			duration,
			location: session.location,
			transcriptText,
			audioBlob,
			metadataJson: JSON.stringify(metadata, null, 2),
		};
	}

	getCurrentSession(): SessionRecording | null {
		return this.currentSession;
	}

	isRecording(): boolean {
		return this.currentSession !== null;
	}
}

export const sessionRecordingService = new SessionRecordingService();
