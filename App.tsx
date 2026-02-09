import React, { useState, useEffect, useRef, useCallback } from "react";
import {
	GoogleGenAI,
	LiveServerMessage,
	Modality,
	Type,
	FunctionDeclaration,
} from "@google/genai";
import {
	decode,
	decodeAudioData,
	createBlob,
	blobToBase64,
	encodeWAV,
} from "./services/audioUtils";
import { evidenceService, IncidentReport } from "./services/evidenceService";
import {
	sessionRecordingService,
	SessionPackage,
} from "./services/sessionRecordingService";
import { apiService } from "./services/apiService";
import { TranscriptionEntry, SessionStatus } from "./types";
import TranscriptionView from "./components/TranscriptionView";
import Visualizer from "./components/Visualizer";

const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-12-2025";
const PRO_MODEL_NAME = "gemini-3-pro-preview";
const CODE_WORD_KEY = "legal_protector_codeword";
const VOICE_FINGERPRINT_KEY = "legal_protector_fingerprint";

// Function declaration for saving to Google Drive (Simulated)
const saveLegalRecordDeclaration: FunctionDeclaration = {
	name: "save_to_cloud_storage",
	parameters: {
		type: Type.OBJECT,
		description:
			"Encrypts and uploads a legal incident report, audio logs, and location data to the user's secure cloud storage (Google Drive).",
		properties: {
			officer_details: { type: Type.STRING },
			violation_summary: { type: Type.STRING },
			incident_summary: { type: Type.STRING },
			urgency_level: { type: Type.STRING },
		},
		required: ["officer_details", "violation_summary", "incident_summary"],
	},
};

const triggerEvidenceGatheringDeclaration: FunctionDeclaration = {
	name: "trigger_evidence_gathering",
	parameters: {
		type: Type.OBJECT,
		description:
			"Triggers the secondary Evidence Collector agent to start high-fidelity recording and analysis.",
		properties: {
			reason: {
				type: Type.STRING,
				description: "Details of the sensed police aggravation.",
			},
		},
		required: ["reason"],
	},
};

const notifyOfficerDeclaration: FunctionDeclaration = {
	name: "notify_officer_of_evidence",
	parameters: {
		type: Type.OBJECT,
		description:
			"Notifies the officer that evidence of their illegal conduct has been captured and secured.",
		properties: {
			violation_details: {
				type: Type.STRING,
				description: "The specific illegal acts captured.",
			},
		},
		required: ["violation_details"],
	},
};

const App: React.FC = () => {
	const [isEnrolled, setIsEnrolled] = useState<boolean>(
		!!localStorage.getItem(VOICE_FINGERPRINT_KEY),
	);
	const [enrollStep, setEnrollStep] = useState<1 | 2 | 3>(1);
	const [tempCodeWord, setTempCodeWord] = useState("");
	const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
	const [isRecordingEnrollment, setIsRecordingEnrollment] = useState(false);
	const [lastSyncStatus, setLastSyncStatus] = useState<string | null>(null);
	const [uploadStatus, setUploadStatus] = useState<string | null>(null);

	const [status, setStatus] = useState<SessionStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState<TranscriptionEntry[]>([]);
	const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
		null,
	);

	const [currentInput, setCurrentInput] = useState("");
	const [currentOutput, setCurrentOutput] = useState("");

	const currentInputRef = useRef("");
	const currentOutputRef = useRef("");

	const inputAudioCtxRef = useRef<AudioContext | null>(null);
	const outputAudioCtxRef = useRef<AudioContext | null>(null);
	const inputAnalyserRef = useRef<AnalyserNode | null>(null);
	const outputAnalyserRef = useRef<AnalyserNode | null>(null);
	const nextStartTimeRef = useRef<number>(0);
	const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
	const micStreamRef = useRef<MediaStream | null>(null);
	const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const sessionPromiseRef = useRef<Promise<any> | null>(null);
	const audioChunksRef = useRef<Float32Array[]>([]);
	const isGatheringRef = useRef<boolean>(false);
	const [isGathering, setIsGathering] = useState(false);

	const cleanup = useCallback(() => {
		if (micStreamRef.current) {
			micStreamRef.current.getTracks().forEach((track) => track.stop());
			micStreamRef.current = null;
		}
		if (scriptProcessorRef.current) {
			scriptProcessorRef.current.disconnect();
			scriptProcessorRef.current = null;
		}
		sourcesRef.current.forEach((source) => source.stop());
		sourcesRef.current.clear();
		if (inputAudioCtxRef.current) {
			inputAudioCtxRef.current.close();
			inputAudioCtxRef.current = null;
		}
		if (outputAudioCtxRef.current) {
			outputAudioCtxRef.current.close();
			outputAudioCtxRef.current = null;
		}
		setStatus("idle");
		nextStartTimeRef.current = 0;
		audioChunksRef.current = [];
		isGatheringRef.current = false;
		setIsGathering(false);
	}, []);

	useEffect(() => {
		if ("geolocation" in navigator) {
			navigator.geolocation.getCurrentPosition((position) => {
				setLocation({
					lat: position.coords.latitude,
					lng: position.coords.longitude,
				});
			});
		}
	}, []);

	// Setup idle callback for auto-upload
	useEffect(() => {
		sessionRecordingService.setIdleCallback(
			async (sessionPackage: SessionPackage) => {
				console.warn("[IDLE TIMEOUT] Auto-uploading evidence to backend...");
				setUploadStatus("⚠️ Idle detected - Auto-uploading evidence...");

				const result = await apiService.uploadSessionPackage(
					sessionPackage,
					"idle_timeout",
				);

				if (result.success) {
					setUploadStatus(`✓ Evidence uploaded: ${result.evidenceId}`);
					console.log("[IDLE TIMEOUT] Upload successful:", result);
				} else {
					setUploadStatus(`✗ Upload failed: ${result.message}`);
					console.error("[IDLE TIMEOUT] Upload failed:", result.message);
				}

				// Also download locally as backup
				downloadSessionPackage(sessionPackage);

				// Clear status after 5 seconds
				setTimeout(() => setUploadStatus(null), 5000);
			},
		);
	}, []);

	const downloadSessionPackage = (sessionPackage: SessionPackage) => {
		// Download transcript
		const transcriptBlob = new Blob([sessionPackage.transcriptText], {
			type: "text/plain",
		});
		const transcriptUrl = URL.createObjectURL(transcriptBlob);
		const transcriptLink = document.createElement("a");
		transcriptLink.href = transcriptUrl;
		transcriptLink.download = `transcript_${sessionPackage.sessionId.slice(
			0,
			8,
		)}.txt`;
		document.body.appendChild(transcriptLink);
		transcriptLink.click();
		document.body.removeChild(transcriptLink);
		URL.revokeObjectURL(transcriptUrl);

		// Download audio
		const audioUrl = URL.createObjectURL(sessionPackage.audioBlob);
		const audioLink = document.createElement("a");
		audioLink.href = audioUrl;
		audioLink.download = `recording_${sessionPackage.sessionId.slice(
			0,
			8,
		)}.wav`;
		document.body.appendChild(audioLink);
		audioLink.click();
		document.body.removeChild(audioLink);
		URL.revokeObjectURL(audioUrl);

		// Download metadata
		const metadataBlob = new Blob([sessionPackage.metadataJson], {
			type: "application/json",
		});
		const metadataUrl = URL.createObjectURL(metadataBlob);
		const metadataLink = document.createElement("a");
		metadataLink.href = metadataUrl;
		metadataLink.download = `metadata_${sessionPackage.sessionId.slice(
			0,
			8,
		)}.json`;
		document.body.appendChild(metadataLink);
		metadataLink.click();
		document.body.removeChild(metadataLink);
		URL.revokeObjectURL(metadataUrl);

		console.log("Session package downloaded locally");
	};

	const startEnrollmentRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const recorder = new MediaRecorder(stream);
			const chunks: globalThis.Blob[] = [];
			recorder.ondataavailable = (e) => chunks.push(e.data);
			recorder.onstop = async () => {
				setEnrollStep(3);
				const audioBlob = new globalThis.Blob(chunks, { type: "audio/webm" });
				await profileVoice(audioBlob);
				stream.getTracks().forEach((t) => t.stop());
			};
			mediaRecorderRef.current = recorder;
			recorder.start();
			setIsRecordingEnrollment(true);
			setTimeout(() => {
				if (recorder.state === "recording") recorder.stop();
				setIsRecordingEnrollment(false);
			}, 4000);
		} catch (err) {
			setError("Mic access denied.");
		}
	};

	const profileVoice = async (audioBlob: globalThis.Blob) => {
		try {
			const base64Audio = await blobToBase64(audioBlob);
			const ai = new GoogleGenAI({
				apiKey: import.meta.env.VITE_GEMINI_API_KEY || "",
			});
			const response = await ai.models.generateContent({
				model: PRO_MODEL_NAME,
				contents: [
					{
						parts: [
							{ inlineData: { data: base64Audio, mimeType: "audio/webm" } },
							{
								text: `Analyze voice fingerprint for Nigerian Legal Protector AI. Word: "${tempCodeWord}".`,
							},
						],
					},
				],
			});
			if (response.text) {
				localStorage.setItem(CODE_WORD_KEY, tempCodeWord);
				localStorage.setItem(VOICE_FINGERPRINT_KEY, response.text);
				setIsEnrolled(true);
				setEnrollStep(1);
				setTempCodeWord("");
			}
		} catch (err) {
			setError("Profiling failed.");
			setEnrollStep(2);
		}
	};

	const startSession = async () => {
		const storedCode = localStorage.getItem(CODE_WORD_KEY);
		const storedFingerprint = localStorage.getItem(VOICE_FINGERPRINT_KEY);

		try {
			setError(null);
			setStatus("connecting");

			// Start session recording
			const sessionId = sessionRecordingService.startRecording(location, 16000);
			console.log("[SESSION] Recording started:", sessionId);

			const ai = new GoogleGenAI({
				apiKey: import.meta.env.VITE_GEMINI_API_KEY || "",
			});
			const inputCtx = new (window.AudioContext ||
				(window as any).webkitAudioContext)({ sampleRate: 16000 });
			const outputCtx = new (window.AudioContext ||
				(window as any).webkitAudioContext)({ sampleRate: 24000 });
			inputAudioCtxRef.current = inputCtx;
			outputAudioCtxRef.current = outputCtx;
			const inAnalyser = inputCtx.createAnalyser();
			const outAnalyser = outputCtx.createAnalyser();
			inputAnalyserRef.current = inAnalyser;
			outputAnalyserRef.current = outAnalyser;

			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			micStreamRef.current = stream;

			const sessionPromise = ai.live.connect({
				model: MODEL_NAME,
				callbacks: {
					onopen: () => {
						console.log("Session Opened - Protector Online");
						console.log("[LIVE TRANSCRIPTION] Real-time transcription active");
						console.log("[AUDIO RECORDING] Full session recording in progress");
						setStatus("active");
						const source = inputCtx.createMediaStreamSource(stream);
						source.connect(inAnalyser);
						const processor = inputCtx.createScriptProcessor(4096, 1, 1);
						scriptProcessorRef.current = processor;
						processor.onaudioprocess = (e) => {
							const inputData = e.inputBuffer.getChannelData(0);
							const pcmBlob = createBlob(inputData);
							sessionPromise.then((s) =>
								s.sendRealtimeInput({ media: pcmBlob }),
							);

							// Record all audio to session recording
							sessionRecordingService.addAudioChunk(inputData);

							// Agent 2: Evidence Gathering
							if (isGatheringRef.current) {
								audioChunksRef.current.push(new Float32Array(inputData));
							}
						};
						source.connect(processor);
						processor.connect(inputCtx.destination);
					},
					onmessage: async (message: LiveServerMessage) => {
						console.log("Message received:", Object.keys(message));
						if (message.toolCall) {
							console.log("Tool Call Request:", message.toolCall);
							for (const fc of message.toolCall.functionCalls) {
								if (fc.name === "save_to_cloud_storage") {
									setStatus("syncing");
									setLastSyncStatus(`Uploading Evidence...`);

									const report: IncidentReport = {
										id: crypto.randomUUID(),
										timestamp: Date.now(),
										officer_details: fc.args.officer_details as string,
										violation_summary: fc.args.violation_summary as string,
										incident_summary: fc.args.incident_summary as string,
										urgency_level:
											(fc.args.urgency_level as string) || "Monitoring",
										location: location,
										history: history,
									};

									evidenceService.saveIncidentReport(report);
									evidenceService.exportReportToFile(report);

									await new Promise((r) => setTimeout(r, 2500));
									setLastSyncStatus(`Evidence Secured Locally & Cloud.`);
									setStatus("active");
									sessionPromise.then((s) =>
										s.sendToolResponse({
											functionResponses: {
												id: fc.id,
												name: fc.name,
												response: {
													status:
														"Evidence encrypted, uploaded to cloud, and saved to local disk.",
												},
											},
										}),
									);
								} else if (fc.name === "trigger_evidence_gathering") {
									console.log("AGENT 2 (Evidence Collector) ACTIVATED");
									isGatheringRef.current = true;
									setIsGathering(true);
									setStatus("gathering");
									setLastSyncStatus("Evidence Collector Active...");

									sessionPromise.then((s) =>
										s.sendToolResponse({
											functionResponses: {
												id: fc.id,
												name: fc.name,
												response: {
													status:
														"Evidence Collector (Agent 2) is now ACTIVE and recording high-fidelity chunks in the background. Be silent and report violations via 'notify_officer_of_evidence'.",
												},
											},
										}),
									);
								} else if (fc.name === "notify_officer_of_evidence") {
									const violation = fc.args.violation_details as string;
									console.log("VIOLATION LOGGED:", violation);

									// Process collected audio chunks into a WAV
									let audioBlob = undefined;
									if (audioChunksRef.current.length > 0) {
										const totalLength = audioChunksRef.current.reduce(
											(acc, curr) => acc + curr.length,
											0,
										);
										const mergedSamples = new Float32Array(totalLength);
										let offset = 0;
										for (const chunk of audioChunksRef.current) {
											mergedSamples.set(chunk, offset);
											offset += chunk.length;
										}
										audioBlob = encodeWAV(mergedSamples, 16000);
									}

									evidenceService.addEvidenceFragment({
										id: crypto.randomUUID(),
										timestamp: Date.now(),
										transcript:
											currentInputRef.current ||
											"Violation detected in dialogue",
										violation_type: violation,
										location: location,
										audioBlob: audioBlob,
									});

									setLastSyncStatus(
										`Violation #${
											(evidenceService as any).activeSessionEvidences?.length ||
											""
										} Captured.`,
									);

									// Reset chunks for the next segment
									audioChunksRef.current = [];

									sessionPromise.then((s) =>
										s.sendToolResponse({
											functionResponses: {
												id: fc.id,
												name: fc.name,
												response: {
													status:
														"Violation logged successfully. Agent 1 (Advocacy) should now verbally inform the officer of this specific capture.",
												},
											},
										}),
									);
								}
							}
						}

						if (message.serverContent?.outputTranscription) {
							const text = message.serverContent.outputTranscription.text;
							console.log("Model Transcription:", text);
							if (
								text.toLowerCase().includes("authorized") ||
								text.toLowerCase().includes("verified")
							)
								setIsAuthenticated(true);
							currentOutputRef.current += text;
							setCurrentOutput(currentOutputRef.current);

							// Update activity for idle detection
							sessionRecordingService.updateActivity();
						} else if (message.serverContent?.inputTranscription) {
							const text = message.serverContent.inputTranscription.text;
							console.log("User Transcription:", text);
							currentInputRef.current += text;
							setCurrentInput(currentInputRef.current);

							// Update activity for idle detection
							sessionRecordingService.updateActivity();
						}

						if (message.serverContent?.turnComplete) {
							console.log("Turn Complete - Flushing History");
							setHistory((prev) => {
								const newEntries: TranscriptionEntry[] = [];
								if (currentInputRef.current) {
									const userEntry = {
										id: crypto.randomUUID(),
										role: "user" as const,
										text: currentInputRef.current,
										timestamp: Date.now(),
									};
									newEntries.push(userEntry);
									sessionRecordingService.addTranscriptEntry(userEntry);
								}
								if (currentOutputRef.current) {
									const modelEntry = {
										id: crypto.randomUUID(),
										role: "model" as const,
										text: currentOutputRef.current,
										timestamp: Date.now(),
									};
									newEntries.push(modelEntry);
									sessionRecordingService.addTranscriptEntry(modelEntry);
								}
								return [...prev, ...newEntries];
							});
							currentInputRef.current = "";
							currentOutputRef.current = "";
							setCurrentInput("");
							setCurrentOutput("");
						}

						const base64Audio =
							message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
						if (base64Audio) {
							console.log("Received Audio Chunk");
							const startTime = Math.max(
								nextStartTimeRef.current,
								outputCtx.currentTime,
							);
							const audioBuffer = await decodeAudioData(
								decode(base64Audio),
								outputCtx,
								24000,
								1,
							);
							const source = outputCtx.createBufferSource();
							source.buffer = audioBuffer;
							source.connect(outAnalyser);
							outAnalyser.connect(outputCtx.destination);
							source.addEventListener("ended", () =>
								sourcesRef.current.delete(source),
							);
							source.start(startTime);
							nextStartTimeRef.current = startTime + audioBuffer.duration;
							sourcesRef.current.add(source);
						}
					},
					onerror: (e) => {
						console.error("Session Error:", e);
						setStatus("idle");
						setError(`Connection Error: ${e.message || "Unknown failure"}`);
						cleanup();
					},
					onclose: () => {
						console.log("Session Closed");
						cleanup();
					},
				},
				config: {
					responseModalities: [Modality.AUDIO],
					outputAudioTranscription: {},
					inputAudioTranscription: {},
					tools: [
						{
							functionDeclarations: [
								saveLegalRecordDeclaration,
								triggerEvidenceGatheringDeclaration,
								notifyOfficerDeclaration,
							],
						},
					],
					speechConfig: {
						voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
					},
					systemInstruction: `STRICT NIGERIAN LEGAL DEFENSE PROTOCOL: DUAL-AGENT MODE.

AGENT 1 (ADVOCACY): 
Role: The vocal persona. Firm, legalistic, authoritative.
- Only you speak verbally to the officer and user.
- CITATION: Cite Police Act Section 35(1) if rights are infringed.
- AGGRAVATION: Call 'trigger_evidence_gathering' if the officer acts aggressively.
- NOTIFICATION: Once Agent 2 reports a violation (via tool call success), you MUST verbally inform the officer: "Officer, your specific violation (e.g., search without warrant) has been captured in high-fidelity audio and secured."

AGENT 2 (INTERNAL EVIDENCE COLLECTOR):
Role: Silent Background Monitor.
- YOU DO NOT SPEAK. Your output MUST NOT contain verbal dialogue.
- ACTION: Specifically monitor for Refusal of ID, Illegal Search, or Unlawful force.
- REPORTING: Call 'notify_officer_of_evidence' for EACH unique violation. DO NOT add verbal commentary.
- COORDINATION: After the tool call, Agent 1 will handle the verbal warning.

TONE: Professional, unyielding, constitutional. Instruct user to remain silent.`,
				},
			});
			sessionPromiseRef.current = sessionPromise;
		} catch (err: any) {
			setError("Mic initialization failed.");
			cleanup();
		}
	};

	const stopSession = async () => {
		console.log("[SESSION] Stopping session...");

		// Stop the Gemini session
		if (sessionPromiseRef.current) {
			sessionPromiseRef.current.then((s) => s.close());
		}

		// Generate session package
		const sessionPackage = sessionRecordingService.stopRecording();

		if (sessionPackage) {
			console.log("[SESSION] Session package generated");
			setUploadStatus("📦 Preparing evidence package...");

			// Download files locally
			downloadSessionPackage(sessionPackage);

			setUploadStatus("✓ Evidence downloaded successfully");

			// Clear status after 3 seconds
			setTimeout(() => setUploadStatus(null), 3000);
		}

		setIsAuthenticated(false);
		cleanup();
	};

	if (!isEnrolled) {
		return (
			<div className="min-h-screen flex items-center justify-center p-6 bg-slate-950">
				<div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-10 shadow-2xl relative">
					<div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-600 to-blue-500" />
					{enrollStep === 1 && (
						<div className="space-y-6">
							<div className="text-center">
								<div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-500/30">
									<span className="text-2xl">⚖️</span>
								</div>
								<h2 className="text-2xl font-black text-white uppercase tracking-tighter">
									Enroll Protector
								</h2>
								<p className="text-slate-400 text-sm mt-2 font-medium">
									Initialize your constitutional key.
								</p>
							</div>
							<input
								type="text"
								value={tempCodeWord}
								onChange={(e) => setTempCodeWord(e.target.value)}
								placeholder="Secret Phrase"
								className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-4 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-center tracking-[0.2em]"
							/>
							<button
								disabled={!tempCodeWord}
								onClick={() => setEnrollStep(2)}
								className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-blue-500/20"
							>
								Init Biometric
							</button>
						</div>
					)}
					{enrollStep === 2 && (
						<div className="space-y-6 text-center">
							<div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/30 relative">
								<div
									className={`absolute inset-0 rounded-full border-4 border-blue-500/50 ${
										isRecordingEnrollment ? "animate-ping" : ""
									}`}
								/>
								<span className="text-3xl">🎙️</span>
							</div>
							<h2 className="text-2xl font-black text-white">
								Vocal Verification
							</h2>
							<p className="text-slate-400 text-sm">
								Speak firmly into the mic:
							</p>
							<div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-blue-400 text-lg">
								"{tempCodeWord}"
							</div>
							{!isRecordingEnrollment ? (
								<button
									onClick={startEnrollmentRecording}
									className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl transition-all shadow-lg"
								>
									Start Capture
								</button>
							) : (
								<div className="py-4 text-blue-400 font-black animate-pulse uppercase tracking-widest">
									Profiling Voice...
								</div>
							)}
						</div>
					)}
					{enrollStep === 3 && (
						<div className="space-y-8 text-center py-12">
							<div className="flex justify-center space-x-3">
								<div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce" />
								<div
									className="w-4 h-4 bg-indigo-500 rounded-full animate-bounce"
									style={{ animationDelay: "150ms" }}
								/>
								<div
									className="w-4 h-4 bg-blue-500 rounded-full animate-bounce"
									style={{ animationDelay: "300ms" }}
								/>
							</div>
							<h2 className="text-xl font-black text-white">
								Encrypting Biometrics
							</h2>
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen max-w-6xl mx-auto px-6 py-8">
			<header className="flex items-center justify-between mb-8 border-b border-slate-900 pb-6">
				<div>
					<div className="flex items-center space-x-3">
						<h1 className="text-3xl font-black tracking-tighter text-white">
							LEGAL PROTECTOR <span className="text-blue-500">AI</span>
						</h1>
						<span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest border border-slate-700">
							CLOUDSYNC ENABLED
						</span>
					</div>
					<div className="flex items-center mt-2 space-x-4">
						<div className="flex items-center">
							<div
								className={`w-2 h-2 rounded-full mr-2 ${
									isAuthenticated
										? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
										: "bg-red-500"
								}`}
							/>
							<p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
								{isAuthenticated ? "Advocacy Active" : "Standby Mode"}
							</p>
						</div>
						{lastSyncStatus && (
							<p className="text-blue-400 text-[10px] font-mono animate-pulse">
								● {lastSyncStatus}
							</p>
						)}
						{uploadStatus && (
							<p className="text-yellow-400 text-[10px] font-mono animate-pulse">
								● {uploadStatus}
							</p>
						)}
						{isGathering && (
							<div className="flex items-center space-x-2 animate-pulse">
								<div className="w-2 h-2 bg-red-600 rounded-full shadow-[0_0_8px_rgba(220,38,38,0.8)]" />
								<p className="text-red-500 text-[10px] font-black uppercase tracking-widest">
									Evidence Collector Active
								</p>
							</div>
						)}
						{sessionRecordingService.isRecording() && (
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
								<p className="text-red-500 text-[10px] font-black uppercase tracking-widest">
									● REC
								</p>
							</div>
						)}
					</div>
				</div>

				<div className="flex items-center space-x-4">
					<button
						onClick={() => {
							localStorage.clear();
							window.location.reload();
						}}
						className="text-slate-600 hover:text-red-500 transition-colors p-2"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							className="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
					</button>
					<div
						className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${
							status === "active" || status === "syncing"
								? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
								: "bg-slate-900 text-slate-600 border border-slate-800"
						}`}
					>
						{status}
					</div>
					{status === "active" || status === "syncing" ? (
						<button
							onClick={stopSession}
							className="px-8 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-lg transition-all shadow-xl shadow-red-900/20 uppercase text-xs"
						>
							Terminate
						</button>
					) : (
						<button
							onClick={startSession}
							className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-lg transition-all shadow-xl shadow-blue-500/20 uppercase text-xs"
						>
							Deploy Defense
						</button>
					)}
				</div>
			</header>

			<main className="flex-1 flex flex-col gap-6 overflow-hidden">
				{error && (
					<div className="bg-red-500/10 border border-red-500/50 text-red-400 px-6 py-4 rounded-xl flex items-center justify-between text-sm font-bold">
						<span>⚠️ {error}</span>
						<button onClick={() => setError(null)}>×</button>
					</div>
				)}

				{!isAuthenticated && status === "active" && (
					<div className="bg-slate-900/90 backdrop-blur-md border border-blue-500/20 p-12 rounded-3xl text-center space-y-4 animate-pulse">
						<div className="text-5xl">🛡️</div>
						<h3 className="text-blue-400 text-xl font-black uppercase tracking-widest">
							Monitoring Encrypted Stream
						</h3>
						<p className="text-slate-500 max-w-lg mx-auto text-sm leading-relaxed">
							System is passive. Authorize with code word to allow primary
							responder to address law enforcement.
						</p>
					</div>
				)}

				<div
					className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-all duration-700 ${
						!isAuthenticated && status === "active"
							? "opacity-10 blur-xl pointer-events-none"
							: "opacity-100"
					}`}
				>
					<div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 backdrop-blur-sm relative">
						<h3 className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-2">
							Officer Input / Environment
						</h3>
						<Visualizer
							analyser={inputAnalyserRef.current}
							isActive={
								status === "active" ||
								status === "syncing" ||
								status === "gathering"
							}
							color={isGathering ? "#ef4444" : "#3b82f6"}
						/>
						{isGathering && (
							<div className="absolute top-4 right-4 text-[8px] font-black text-red-500 uppercase tracking-tighter bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
								Agent 2 Rec.
							</div>
						)}
					</div>
					<div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 backdrop-blur-sm">
						<h3 className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-2">
							Protector Advocacy Output
						</h3>
						<Visualizer
							analyser={outputAnalyserRef.current}
							isActive={status === "active" || status === "syncing"}
							color="#10b981"
						/>
					</div>
				</div>

				<div
					className={`flex-1 flex flex-col min-h-0 bg-slate-950/20 rounded-3xl relative border border-slate-900 overflow-hidden transition-all duration-700 ${
						!isAuthenticated && status === "active"
							? "opacity-5 blur-2xl"
							: "opacity-100"
					}`}
				>
					<TranscriptionView
						history={history}
						currentInput={currentInput}
						currentOutput={currentOutput}
						isActive={
							status === "active" ||
							status === "syncing" ||
							status === "gathering"
						}
					/>
					{status === "syncing" && (
						<div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center space-y-4 backdrop-blur-sm z-50">
							<div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
							<p className="text-blue-400 font-black text-xs uppercase tracking-[0.3em]">
								Syncing Evidence to Google Drive
							</p>
						</div>
					)}
				</div>
			</main>

			<footer className="mt-8 pt-6 border-t border-slate-900 flex justify-between items-center opacity-40">
				<p className="text-slate-600 text-[9px] font-black uppercase tracking-tighter">
					憲法遵守 &bull; CONSTITUTIONAL GUARD &bull; AUTO-SYNC ACTIVE
				</p>
				<p className="text-slate-600 text-[10px] font-mono">
					{isAuthenticated ? "LOGGING_TO_DRIVE_01" : "WATCH_STANDBY"}
				</p>
			</footer>

			<div className="fixed -z-10 top-0 left-0 w-full h-full pointer-events-none opacity-20">
				<div
					className={`absolute top-[-20%] left-[-10%] w-[60%] h-[60%] blur-[150px] rounded-full transition-colors duration-1000 ${
						isAuthenticated ? "bg-emerald-900/30" : "bg-blue-900/30"
					}`}
				/>
			</div>
		</div>
	);
};

export default App;
