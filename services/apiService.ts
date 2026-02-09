import { SessionPackage } from "./sessionRecordingService";

const API_ENDPOINT =
	"https://bk4ezxambg.execute-api.us-east-1.amazonaws.com/send-evidence";

export interface UploadResponse {
	success: boolean;
	message: string;
	evidenceId?: string;
	receiptUrl?: string;
}

export const apiService = {
	/**
	 * Uploads session package to backend in case of emergency (idle timeout)
	 * or when user explicitly saves evidence
	 */
	uploadSessionPackage: async (
		sessionPackage: SessionPackage,
		reason: "idle_timeout" | "user_terminated" | "emergency",
	): Promise<UploadResponse> => {
		try {
			const formData = new FormData();

			// Description field - includes session metadata
			const description = `
Legal Protector AI - Evidence Upload
Reason: ${
				reason === "idle_timeout"
					? "Automatic upload (30s idle - possible rights violation)"
					: reason === "emergency"
					? "Emergency situation"
					: "User terminated session"
			}
Session ID: ${sessionPackage.sessionId}
Timestamp: ${sessionPackage.timestamp}
Duration: ${sessionPackage.duration}s
Location: ${
				sessionPackage.location
					? `${sessionPackage.location.lat}, ${sessionPackage.location.lng}`
					: "Unknown"
			}
      `.trim();

			formData.append("description", description);

			// Transcript field - plain text content
			formData.append("transcript", sessionPackage.transcriptText);

			// Recipients - hardcoded email
			formData.append("recipients", "theahmadmj23@gmail.com");

			// Text file - transcript as .txt file
			const transcriptBlob = new Blob([sessionPackage.transcriptText], {
				type: "text/plain",
			});
			formData.append(
				"text_file",
				transcriptBlob,
				`transcript_${sessionPackage.sessionId.slice(0, 8)}.txt`,
			);

			// Audio file - recording as .wav file
			formData.append(
				"audio",
				sessionPackage.audioBlob,
				`recording_${sessionPackage.sessionId.slice(0, 8)}.wav`,
			);

			console.log(`[API] Uploading to ${API_ENDPOINT}...`);
			console.log(`[API] Reason: ${reason}`);
			console.log(`[API] Session ID: ${sessionPackage.sessionId}`);
			console.log(`[API] Duration: ${sessionPackage.duration}s`);
			console.log(
				`[API] Audio size: ${(sessionPackage.audioBlob.size / 1024).toFixed(
					2,
				)} KB`,
			);
			console.log(
				`[API] Transcript length: ${sessionPackage.transcriptText.length} chars`,
			);
			console.log(`[API] Recipients: theahmadmj23@gmail.com`);

			const response = await fetch(API_ENDPOINT, {
				method: "POST",
				body: formData,
				// Note: Don't set Content-Type header - browser will set it automatically with boundary
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`HTTP ${response.status}: ${errorText || response.statusText}`,
				);
			}

			const data = await response.json();

			console.log("[API] Upload successful:", data);

			return {
				success: true,
				message: data.message || "Evidence uploaded successfully",
				evidenceId: data.evidenceId || sessionPackage.sessionId,
				receiptUrl: data.receiptUrl,
			};
		} catch (error) {
			console.error("[API] Upload failed:", error);
			return {
				success: false,
				message: error instanceof Error ? error.message : "Upload failed",
			};
		}
	},
};
