import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Send, Terminal, Settings, User, X, Save, MessageSquare, ChevronRight, MapPin, Radio, Mic, Database, LogOut } from 'lucide-react';
import DelamainFace from './components/DelamainFace';
import { DataDashboard } from './components/DataDashboard';
import { LoginPage } from './components/LoginPage';
import { playConnectChime, playResponsePing, playDisconnectTone } from './utils/sounds';

interface NavOption {
  name: string;
  address: string;
  lat: string;
  lon: string;
}

interface Message {
  role: 'user' | 'delamain';
  content: string;
}

interface AppSettings {
  userName: string;
  llmUrl: string;
  backendUrl: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  userName: 'Guest',
  llmUrl: 'http://localhost:8080/v1/chat/completions',
  backendUrl: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 150,
};

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('delamain_token'));

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  return <MainApp token={token} onLogout={() => { localStorage.removeItem('delamain_token'); setToken(null); }} />;
}

interface MainAppProps {
  token: string;
  onLogout: () => void;
}

function MainApp({ token, onLogout }: MainAppProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTalking, setIsTalking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDataOpen, setIsDataOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('delamain_settings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
    return DEFAULT_SETTINGS;
  });
  const [tempSettings, setTempSettings] = useState<AppSettings>(settings);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [navOptions, setNavOptions] = useState<NavOption[]>([]);
  const [spConnected, setSpConnected] = useState(false);
  const [liveVehicleState, setLiveVehicleState] = useState<Record<string, any>>({});
  const [faceMode, setFaceMode] = useState<'idle' | 'angry'>('idle');
  const [isListening, setIsListening] = useState(false);
  const faceModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);

  // Audio queue — prevents vehicle event voices from overlapping
  const audioQueueRef = useRef<Array<{ url: string; text?: string }>>([]);
  const audioPlayingRef = useRef(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    localStorage.setItem('delamain_settings', JSON.stringify(settings));
  }, [settings]);

  // Handle 401s from data API — if token is rejected, log out
  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => r,
      err => {
        if (err?.response?.status === 401) onLogout();
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, [onLogout]);

  // WebSocket: connect on mount to receive greeting + voice responses
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const clientId = `web-${Date.now()}`;
    const ws = new WebSocket(`${proto}://${location.host}/ws/${clientId}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    const playNext = () => {
      const item = audioQueueRef.current.shift();
      if (!item) { audioPlayingRef.current = false; setIsTalking(false); return; }
      const { url: audioUrl, text } = item;
      const url = audioUrl.startsWith('http') ? audioUrl : `${location.origin}${audioUrl}`;
      const audio = new Audio(url);
      audio.onplay  = () => setIsTalking(true);
      audio.onended = () => { playNext(); };
      audio.onerror = () => { playNext(); };
      audio.play().catch(() => {
        if (text) {
          setIsTalking(true);
          setTimeout(() => { playNext(); }, Math.max(2000, text.length * 60));
        } else { playNext(); }
      });
    };

    const playAudio = (audioUrl: string, text?: string) => {
      audioQueueRef.current.push({ url: audioUrl, text });
      if (!audioPlayingRef.current) {
        audioPlayingRef.current = true;
        playNext();
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'vehicle_state') {
        setLiveVehicleState(msg.data);
      } else if (msg.type === 'sp_status') {
        setSpConnected(msg.connected);
      } else if (msg.type === 'greeting') {
        playConnectChime();
        if (msg.audio_url) playAudio(msg.audio_url, msg.text);
        if (msg.text) setMessages(prev => [...prev, { role: 'delamain', content: msg.text }]);
      } else if (msg.type === 'response') {
        setIsLoading(false);
        if (msg.source === 'sp_connect') setSpConnected(true);
        if (msg.source === 'sp_disconnect') {
          setSpConnected(false);
          playDisconnectTone();
        }
        playResponsePing();
        if (msg.audio_url) playAudio(msg.audio_url, msg.text);
        if (msg.text) setMessages(prev => [...prev, { role: 'delamain', content: msg.text }]);
        if (msg.navigate_options?.length === 1) {
          navigateToCoords(msg.navigate_options[0]);
        } else if (msg.navigate_options?.length > 1) {
          setNavOptions(msg.navigate_options);
        }
      }
    };

    ws.onclose = (e) => {
      if (e.code === 4001) onLogout();
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [token]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const RUDE_PATTERNS = /\b(fuck(?:\s+(?:you|off|this))?|screw you|go to hell|shut up|hate you|piece of (shit|crap)|asshole|you('re| are) (stupid|useless|garbage|worthless|an idiot|dumb)|idiot|moron)\b/i;

  const triggerAngry = () => {
    if (faceModeTimerRef.current) clearTimeout(faceModeTimerRef.current);
    setFaceMode('angry');
    faceModeTimerRef.current = setTimeout(() => setFaceMode('idle'), 12000);
  };

  const handleSend = async (overrideText?: string) => {
    const userMessage = (overrideText ?? input).trim();
    if (!userMessage) return;

    if (!overrideText) setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    if (RUDE_PATTERNS.test(userMessage)) triggerAngry();

    // Prefer WebSocket so the response arrives through the same handler as greeting
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'talk', text: userMessage, user_name: settings.userName }));
      return; // response arrives via ws.onmessage
    }

    // Fallback: REST
    try {
      const response = await axios.post(`${settings.backendUrl}/api/chat`, {
        message: userMessage,
        llm_url: settings.llmUrl,
        system_prompt: settings.systemPrompt || undefined,
        user_name: settings.userName,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens
      }, { headers: { Authorization: `Bearer ${token}` } });

      const delamainResponse = response.data.response;
      const audioUrl = response.data.audio_url;
      const opts: NavOption[] = response.data.navigate_options ?? [];

      setIsLoading(false);
      setMessages(prev => [...prev, { role: 'delamain', content: delamainResponse }]);
      if (opts.length === 1) navigateToCoords(opts[0]);
      else if (opts.length > 1) setNavOptions(opts);

      if (audioUrl) {
        const url = audioUrl.startsWith('http') ? audioUrl : `${location.origin}${audioUrl}`;
        const audio = new Audio(url);
        audio.onplay = () => setIsTalking(true);
        audio.onended = () => setIsTalking(false);
        audio.onerror = () => setIsTalking(false);
        audio.play().catch(() => {
          setIsTalking(true);
          setTimeout(() => setIsTalking(false), Math.max(2000, delamainResponse.length * 50));
        });
      } else {
        setIsTalking(true);
        setTimeout(() => setIsTalking(false), Math.max(2000, delamainResponse.length * 50));
      }

    } catch (error) {
      console.error('Error contacting Delamain:', error);
      setMessages(prev => [...prev, { 
        role: 'delamain', 
        content: 'Error: Connection to my core subroutines has been interrupted. Please check my server status.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const recognition = new SR();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setIsListening(false);
        handleSend(text);
      };
      recognition.onend  = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      return;
    }

    // Fallback — open chat and focus the text input
    setIsChatOpen(true);
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const navigateToCoords = (_opt: NavOption) => {
    setNavOptions([]);
  };

  const saveSettings = () => {
    setSettings(tempSettings);
    setIsSettingsOpen(false);
  };

  return (
    <div className="flex bg-cyber-dark text-gray-200 font-rajdhani overflow-hidden h-screen">
      {/* Sidebar (Minimal) */}
      <div className="w-16 border-r border-cyber-gray flex flex-col items-center py-6 gap-8 z-20">
        <div className="p-2 bg-cyber-blue/10 rounded-lg text-cyber-blue">
          <Terminal size={24} />
        </div>
        <button
          onClick={() => {
            setTempSettings(settings);
            setIsSettingsOpen(true);
          }}
          className="p-2 hover:bg-cyber-gray rounded-lg transition-colors text-gray-500 hover:text-cyber-blue"
          title="Settings"
        >
          <Settings size={24} />
        </button>
        <button
          onClick={() => setIsChatOpen(o => !o)}
          className={`p-2 rounded-lg transition-colors ${isChatOpen ? 'bg-cyber-blue/20 text-cyber-blue' : 'text-gray-500 hover:text-cyber-blue hover:bg-cyber-gray'}`}
          title="Toggle chat"
        >
          <MessageSquare size={24} />
        </button>
        <button
          onClick={() => setIsDataOpen(o => !o)}
          className={`p-2 rounded-lg transition-colors ${isDataOpen ? 'bg-cyber-blue/20 text-cyber-blue' : 'text-gray-500 hover:text-cyber-blue hover:bg-cyber-gray'}`}
          title="Data explorer"
        >
          <Database size={24} />
        </button>
        <div className="mt-auto flex flex-col items-center gap-3 pb-1">
          <div
            title={spConnected ? 'SUNNYPILOT LINK ACTIVE' : 'SUNNYPILOT LINK OFFLINE'}
            className={`flex flex-col items-center gap-1 transition-colors duration-500 ${spConnected ? 'text-green-400' : 'text-gray-700'}`}
          >
            <Radio size={18} />
            <span className="text-[8px] font-bold tracking-widest">SP</span>
            <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${spConnected ? 'bg-green-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.7)]' : 'bg-gray-700'}`} />
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
          >
            <LogOut size={18} />
          </button>
          <div className="p-2 text-cyber-blue/50">
            <div className="w-2 h-2 rounded-full bg-cyber-blue animate-pulse" />
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-cyber-dark border border-cyber-blue/30 rounded-lg overflow-hidden shadow-[0_0_30px_rgba(0,240,255,0.15)]">
            <div className="p-4 border-b border-cyber-gray flex justify-between items-center bg-cyber-blue/5">
              <h2 className="text-cyber-blue font-bold flex items-center gap-2">
                <Settings size={18} />
                SYSTEM_CONFIGURATION
              </h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto scrollbar-thin scrollbar-thumb-cyber-blue/20">
              <div className="space-y-2">
                <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">User Designation</label>
                <input 
                  type="text" 
                  value={tempSettings.userName}
                  onChange={e => setTempSettings({...tempSettings, userName: e.target.value})}
                  className="w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded p-2 text-sm focus:outline-none focus:border-cyber-blue/50"
                  placeholder="e.g. V, Guest, Major"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">Backend API Endpoint</label>
                <input 
                  type="text" 
                  value={tempSettings.backendUrl}
                  onChange={e => setTempSettings({...tempSettings, backendUrl: e.target.value})}
                  className="w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded p-2 text-sm focus:outline-none focus:border-cyber-blue/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">LLM Core URL (llama.cpp)</label>
                <input 
                  type="text" 
                  value={tempSettings.llmUrl}
                  onChange={e => setTempSettings({...tempSettings, llmUrl: e.target.value})}
                  className="w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded p-2 text-sm focus:outline-none focus:border-cyber-blue/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">Directive Override (System Prompt)</label>
                <textarea 
                  value={tempSettings.systemPrompt}
                  onChange={e => setTempSettings({...tempSettings, systemPrompt: e.target.value})}
                  className="w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded p-2 text-sm focus:outline-none focus:border-cyber-blue/50 h-24 resize-none"
                  placeholder="Leave empty for default Delamain persona..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">Entropy (Temp)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0"
                    max="2"
                    value={tempSettings.temperature}
                    onChange={e => setTempSettings({...tempSettings, temperature: parseFloat(e.target.value)})}
                    className="w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded p-2 text-sm focus:outline-none focus:border-cyber-blue/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">Max Tokens</label>
                  <input 
                    type="number" 
                    value={tempSettings.maxTokens}
                    onChange={e => setTempSettings({...tempSettings, maxTokens: parseInt(e.target.value)})}
                    className="w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded p-2 text-sm focus:outline-none focus:border-cyber-blue/50"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-cyber-gray bg-cyber-dark flex justify-end gap-3">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-white transition-colors"
              >
                DISCARD
              </button>
              <button 
                onClick={saveSettings}
                className="px-4 py-2 bg-cyber-blue/20 border border-cyber-blue/50 text-cyber-blue text-xs font-bold rounded flex items-center gap-2 hover:bg-cyber-blue/30 transition-colors"
              >
                <Save size={14} />
                APPLY_CHANGES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* Face Panel — expands to fill when chat is closed */}
        {/* pr-16 balances the 64px sidebar so the face centres on the full screen */}
        <div className={`relative flex flex-col items-center justify-center px-6 pt-4 pb-24 transition-all duration-300 ${isChatOpen ? 'flex-1 md:border-r border-cyber-gray' : 'flex-1 pr-16'}`}>
          {/* Wordmark */}
          <div className="mb-3 flex flex-col items-center gap-1">
            <h1
              className="font-rajdhani font-bold uppercase leading-none tracking-[0.55em] text-cyber-blue text-5xl"
              style={{ textShadow: '0 0 18px rgba(0,243,255,0.65), 0 0 50px rgba(0,243,255,0.2)' }}
            >
              DELAMAIN
            </h1>
            <div className="flex items-center gap-3">
              <div className="h-px w-16 bg-gradient-to-r from-transparent to-cyber-blue/35" />
              <span className="text-[8px] tracking-[0.45em] text-cyber-blue/35 font-mono uppercase">Executive Transport</span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-cyber-blue/35" />
            </div>
          </div>

          <DelamainFace isTalking={isTalking} mood={faceMode} size="large" />

          {/* Talk bar — full-width, pinned to bottom of face panel */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
            <button
              onClick={toggleListening}
              disabled={isLoading}
              className={`relative w-full h-14 rounded-lg flex items-center justify-center gap-3 transition-all duration-300 disabled:opacity-40
                ${isListening
                  ? 'bg-cyber-blue/20 border border-cyber-blue shadow-[0_0_24px_rgba(0,243,255,0.45)]'
                  : 'bg-cyber-gray/80 border border-cyber-blue/30 hover:border-cyber-blue/60 hover:bg-cyber-blue/10 active:bg-cyber-blue/20'
                }`}
            >
              <Mic size={20} className={`flex-shrink-0 transition-colors ${isListening ? 'text-cyber-blue animate-pulse' : 'text-cyber-blue/50'}`} />
              <span className={`text-xs font-bold tracking-[0.35em] uppercase transition-colors ${isListening ? 'text-cyber-blue' : 'text-cyber-blue/40'}`}>
                {isListening ? 'Listening...' : 'Speak to Delamain'}
              </span>
              {!isListening && !(window as any).SpeechRecognition && !(window as any).webkitSpeechRecognition && (
                <span className="text-[9px] text-cyber-blue/25 font-mono ml-1">[type]</span>
              )}
              {isListening && (
                <div className="absolute inset-0 rounded-lg border border-cyber-blue/30 animate-ping" />
              )}
            </button>
          </div>
        </div>

        {/* Data Explorer Panel */}
        {isDataOpen && (
          <div className="flex flex-col bg-cyber-gray/30 backdrop-blur-sm overflow-hidden transition-all duration-300 w-full md:w-[560px]">
            <DataDashboard token={token} liveVehicleState={liveVehicleState} onClose={() => setIsDataOpen(false)} />
          </div>
        )}

        {/* Right Panel: Chat Interface — hidden by default */}
        <div className={`flex flex-col bg-cyber-gray/30 backdrop-blur-sm overflow-hidden transition-all duration-300 ${isChatOpen ? 'w-full md:w-[450px]' : 'w-0 md:w-0'}`}>
          {/* Header */}
          <div className="p-4 border-b border-cyber-gray flex justify-between items-center bg-cyber-dark/50 min-w-[450px]">
            <span className="text-xs font-bold text-cyber-blue flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
              SYSTEM_READY
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-gray-500">ENCRYPTED_LINE_77</span>
              <button onClick={() => setIsChatOpen(false)} className="text-gray-500 hover:text-white transition-colors" title="Close chat">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-cyber-blue/20 min-w-[450px]">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-gray-600 text-sm text-center px-8 opacity-50 italic">
                <Terminal size={48} className="mb-4 opacity-20" />
                Wait for system initialization or enter your query to begin the Excelsior experience.
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'delamain' ? (
                  <div className="max-w-[88%] mr-4">
                    <div className="flex items-center gap-2 mb-1.5 text-[9px] tracking-[0.3em] text-cyber-blue/50 uppercase font-mono">
                      <div className="w-1 h-1 rounded-full bg-cyber-blue/60" />
                      Delamain
                    </div>
                    <div className="pl-3 border-l border-cyber-blue/40">
                      <p className="text-[15px] leading-relaxed text-gray-200 font-rajdhani font-medium">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[80%] ml-4 bg-cyber-blue/5 border border-cyber-blue/20 rounded p-3">
                    <div className="flex items-center gap-2 mb-1 text-[9px] tracking-[0.3em] text-cyber-blue/40 uppercase font-mono">
                      <User size={8} />
                      {settings.userName}
                    </div>
                    <p className="text-sm leading-relaxed text-cyber-blue/80 font-rajdhani">{msg.content}</p>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="mr-4 pl-3 border-l border-cyber-blue/40">
                  <div className="flex items-center gap-2 mb-1 text-[9px] tracking-[0.3em] text-cyber-blue/50 uppercase font-mono">
                    <div className="w-1 h-1 rounded-full bg-cyber-blue/60 animate-pulse" />
                    Delamain
                  </div>
                  <div className="flex items-center gap-1.5 h-5">
                    <div className="w-px h-4 bg-cyber-blue/70 animate-pulse" />
                    <span className="text-[11px] tracking-widest text-cyber-blue/40 font-mono uppercase animate-pulse">processing</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-cyber-dark/80 border-t border-cyber-gray min-w-[450px]">
            <div className="relative flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()}
                placeholder="Direct thought input..."
                className="flex-1 bg-cyber-gray/50 border border-cyber-blue/20 rounded-md py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-cyber-blue/50 transition-colors text-cyber-blue placeholder-cyber-blue/30"
              />
              <button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim()}
                className="absolute right-2 p-2 text-cyber-blue hover:bg-cyber-blue/10 rounded-md transition-colors disabled:opacity-30"
              >
                <Send size={20} />
              </button>
            </div>
            <div className="mt-2 text-[10px] text-gray-600 flex justify-between">
              <span>ENTER TO SEND</span>
              <span>SECURE PROTOCOL v2</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation destination picker */}
      {navOptions.length > 0 && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center p-6 pb-28">
          <div className="w-full max-w-md bg-cyber-dark border border-cyber-blue/40 rounded-lg overflow-hidden shadow-[0_0_30px_rgba(0,240,255,0.15)]">
            <div className="p-3 border-b border-cyber-gray flex justify-between items-center bg-cyber-blue/5">
              <span className="text-xs font-bold text-cyber-blue flex items-center gap-2">
                <MapPin size={14} />
                SELECT DESTINATION
              </span>
              <button onClick={() => setNavOptions([])} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="divide-y divide-cyber-gray/50">
              {navOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => navigateToCoords(opt)}
                  className="w-full text-left px-4 py-3 hover:bg-cyber-blue/10 transition-colors"
                >
                  <div className="text-sm text-white font-medium">{opt.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.address}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
