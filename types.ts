export interface TranscriptionEntry {
	id: string;
	role: "user" | "model";
	text: string;
	timestamp: number;
}

export interface EvidenceFragment {
	id: string;
	timestamp: number;
	transcript: string;
	audioBlob?: globalThis.Blob;
	violation_type?: string;
	location?: { lat: number; lng: number } | null;
}

export type SessionStatus =
	| "idle"
	| "connecting"
	| "active"
	| "gathering"
	| "error"
	| "syncing";
