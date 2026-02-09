import React, { useEffect, useRef } from "react";
import { TranscriptionEntry } from "../types";

interface TranscriptionViewProps {
	history: TranscriptionEntry[];
	currentInput: string;
	currentOutput: string;
	isActive?: boolean;
}

const TranscriptionView: React.FC<TranscriptionViewProps> = ({
	history,
	currentInput,
	currentOutput,
	isActive = false,
}) => {
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [history, currentInput, currentOutput]);

	return (
		<div
			ref={scrollRef}
			className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-slate-900/50 rounded-xl border border-slate-800"
		>
			{history.length === 0 && !currentInput && !currentOutput && !isActive && (
				<div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
					<p className="text-lg">Conversation history will appear here.</p>
					<p className="text-sm">
						Click "Deploy Defense" to start live transcription.
					</p>
				</div>
			)}

			{/* Show listening indicator when session is active but no conversation yet */}
			{history.length === 0 && !currentInput && !currentOutput && isActive && (
				<div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
					<div className="flex items-center space-x-3">
						<div className="w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
						<p className="text-lg font-bold uppercase tracking-wider">
							Live Transcription Active
						</p>
					</div>
					<p className="text-sm text-slate-500">
						Speak now - your conversation will appear here in real-time
					</p>
					<div className="flex space-x-2 mt-4">
						<div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
						<div
							className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
							style={{ animationDelay: "0.1s" }}
						></div>
						<div
							className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
							style={{ animationDelay: "0.2s" }}
						></div>
					</div>
				</div>
			)}

			{history.map((item) => (
				<div
					key={item.id}
					className={`flex flex-col ${
						item.role === "user" ? "items-end" : "items-start"
					}`}
				>
					<div
						className={`max-w-[80%] rounded-2xl px-4 py-3 ${
							item.role === "user"
								? "bg-indigo-600 text-white rounded-br-none"
								: "bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700"
						}`}
					>
						<p className="text-sm font-medium mb-1 opacity-70">
							{item.role === "user" ? "You" : "AI Protector"}
						</p>
						<p className="whitespace-pre-wrap">{item.text}</p>
						<p className="text-xs opacity-50 mt-1">
							{new Date(item.timestamp).toLocaleTimeString()}
						</p>
					</div>
				</div>
			))}

			{/* Real-time fragments - showing LIVE as they come in */}
			{currentInput && (
				<div className="flex flex-col items-end">
					<div className="max-w-[80%] rounded-2xl px-4 py-3 bg-indigo-600/50 text-white rounded-br-none border border-indigo-400/30">
						<div className="flex items-center space-x-2 mb-1">
							<div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
							<p className="text-xs font-medium opacity-70 italic uppercase tracking-wider">
								Speaking now...
							</p>
						</div>
						<p className="opacity-90">{currentInput}</p>
					</div>
				</div>
			)}

			{currentOutput && (
				<div className="flex flex-col items-start">
					<div className="max-w-[80%] rounded-2xl px-4 py-3 bg-slate-800 text-slate-200 rounded-bl-none border border-indigo-500/30">
						<div className="flex items-center space-x-2 mb-1">
							<div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
							<p className="text-xs font-medium opacity-70 italic uppercase tracking-wider">
								AI Responding...
							</p>
						</div>
						<p>{currentOutput}</p>
					</div>
				</div>
			)}
		</div>
	);
};

export default TranscriptionView;
