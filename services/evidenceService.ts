import { TranscriptionEntry, EvidenceFragment } from '../types';

export interface IncidentReport {
  id: string;
  timestamp: number;
  officer_details: string;
  violation_summary: string;
  incident_summary: string;
  urgency_level: string;
  location: { lat: number, lng: number } | null;
  history: TranscriptionEntry[];
  evidences?: EvidenceFragment[];
}

const STORAGE_KEY = 'legal_protector_evidence';
let activeSessionEvidences: EvidenceFragment[] = [];

export const evidenceService = {
  saveIncidentReport: (report: IncidentReport) => {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const reportWithEvidences = { ...report, evidences: [...activeSessionEvidences] };
    const updated = [reportWithEvidences, ...existing];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    console.log('Evidence persisted to localStorage:', report.id);
    activeSessionEvidences = []; // Clear after saving
  },

  getAllReports: (): IncidentReport[] => {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  },

  addEvidenceFragment: (fragment: EvidenceFragment) => {
    activeSessionEvidences.push(fragment);
    console.log('Evidence fragment added:', fragment.id);
  },

  clearActiveSession: () => {
    activeSessionEvidences = [];
  },

  exportReportToFile: async (report: IncidentReport) => {
    const timestamp = new Date(report.timestamp).toLocaleString();
    const locationStr = report.location ? `LAT ${report.location.lat}, LNG ${report.location.lng}` : 'Unknown';
    
    let content = `
LEGAL PROTECTOR AI - EVIDENCE PACKAGE
=====================================
Session ID: ${report.id}
Timestamp: ${timestamp}
Location: ${locationStr}
Urgency: ${report.urgency_level}

OFFICER DETAILS:
${report.officer_details}

VIOLATION SUMMARY:
${report.violation_summary}

INCIDENT NARRATIVE:
${report.incident_summary}

-------------------------------------
FULL TRANSCRIPTION LOG:
${report.history.map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] [${e.role.toUpperCase()}] ${e.text}`).join('\n')}

-------------------------------------
GATHERED EVIDENCE FRAGMENTS:
${report.evidences?.map((ev, i) => `
Fragment #${i+1} [${new Date(ev.timestamp).toLocaleTimeString()}]
Violation: ${ev.violation_type || 'N/A'}
Text: ${ev.transcript}
Audio Saved: ${ev.audioBlob ? 'Yes' : 'No'}
`).join('\n')}
    `.trim();

    // In a real app we might use JSZip, but here we provide a comprehensive text log
    // and simulated multi-file export by concatenation if needed.
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `evidence_package_${report.id.slice(0, 8)}.txt`;
    
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Trigger downloads for each audio fragment
    if (report.evidences) {
      for (const [index, ev] of report.evidences.entries()) {
        if (ev.audioBlob) {
          const audioUrl = URL.createObjectURL(ev.audioBlob);
          const audioLink = document.createElement('a');
          audioLink.href = audioUrl;
          audioLink.download = `evidence_audio_fragment_${report.id.slice(0, 8)}_${index + 1}.wav`;
          document.body.appendChild(audioLink);
          audioLink.click();
          document.body.removeChild(audioLink);
          URL.revokeObjectURL(audioUrl);
          // Small delay to ensure browser handles multiple downloads
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }
    
    console.log(`Evidence Package Exported: ${filename} with ${report.evidences?.filter(e => e.audioBlob).length || 0} audio fragments.`);
  }
};
