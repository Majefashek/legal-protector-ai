
import React, { useEffect, useRef } from 'react';
import { TranscriptionEntry } from '../types';

interface TranscriptionViewProps {
  history: TranscriptionEntry[];
  currentInput: string;
  currentOutput: string;
}

const TranscriptionView: React.FC<TranscriptionViewProps> = ({ history, currentInput, currentOutput }) => {
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
      {history.length === 0 && !currentInput && !currentOutput && (
        <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
          <p className="text-lg">Conversation history will appear here.</p>
          <p className="text-sm">Speak to Gemini to get started.</p>
        </div>
      )}

      {history.map((item) => (
        <div 
          key={item.id} 
          className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}
        >
          <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
            item.role === 'user' 
              ? 'bg-indigo-600 text-white rounded-br-none' 
              : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'
          }`}>
            <p className="text-sm font-medium mb-1 opacity-70">
              {item.role === 'user' ? 'You' : 'Gemini'}
            </p>
            <p className="whitespace-pre-wrap">{item.text}</p>
          </div>
        </div>
      ))}

      {/* Real-time fragments */}
      {currentInput && (
        <div className="flex flex-col items-end">
          <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-indigo-600/50 text-white rounded-br-none border border-indigo-400/30">
            <p className="text-xs font-medium mb-1 opacity-70 italic">Listening...</p>
            <p className="opacity-90">{currentInput}</p>
          </div>
        </div>
      )}

      {currentOutput && (
        <div className="flex flex-col items-start">
          <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-slate-800 text-slate-200 rounded-bl-none border border-indigo-500/30">
             <p className="text-xs font-medium mb-1 opacity-70 italic">Responding...</p>
            <p>{currentOutput}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptionView;
