import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Send, Terminal, Settings, User, X, Save, MessageSquare, ChevronRight, Keyboard, MapPin } from 'lucide-react';
import DelamainFace from './components/DelamainFace';

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
  llmUrl: 'http://10.0.1.103:8080/v1/chat/completions',
  backendUrl: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 150,
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTalking, setIsTalking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('delamain_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate: if backendUrl is a local IP, reset to relative (proxy)
      if (parsed.backendUrl && /^https?:\/\/10\.|^https?:\/\/192\.168\.|^https?:\/\/localhost/.test(parsed.backendUrl)) {
        parsed.backendUrl = '';
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
    return DEFAULT_SETTINGS;
  });
  const [tempSettings, setTempSettings] = useState<AppSettings>(settings);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [navOptions, setNavOptions] = useState<NavOption[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    localStorage.setItem('delamain_settings', JSON.stringify(settings));
  }, [settings]);

  // WebSocket: connect on mount to receive greeting + voice responses
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const clientId = `web-${Date.now()}`;
    const ws = new WebSocket(`${proto}://${location.host}/ws/${clientId}`);
    wsRef.current = ws;

    const playAudio = (audioUrl: string, text?: string) => {
      const url = audioUrl.startsWith('http') ? audioUrl : `${location.origin}${audioUrl}`;
      const audio = new Audio(url);
      audio.onplay = () => setIsTalking(true);
      audio.onended = () => setIsTalking(false);
      audio.onerror = () => setIsTalking(false);
      audio.play().catch(() => {
        // Autoplay blocked — animate for estimated duration
        if (text) {
          setIsTalking(true);
          setTimeout(() => setIsTalking(false), Math.max(2000, text.length * 60));
        }
      });
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'greeting') {
        if (msg.audio_url) playAudio(msg.audio_url, msg.text);
        if (msg.text) setMessages(prev => [...prev, { role: 'delamain', content: msg.text }]);
      } else if (msg.type === 'response') {
        setIsLoading(false);
        if (msg.audio_url) playAudio(msg.audio_url, msg.text);
        if (msg.text) setMessages(prev => [...prev, { role: 'delamain', content: msg.text }]);
        if (msg.navigate_options?.length === 1) {
          navigateToCoords(msg.navigate_options[0]);
        } else if (msg.navigate_options?.length > 1) {
          setNavOptions(msg.navigate_options);
        }
      }
    };

    return () => { ws.close(); wsRef.current = null; };
  }, []);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Tell native Android wrapper to hide/show the Talk button overlay when a panel is open
  useEffect(() => {
    try {
      const bridge = (window as any).DelamainNative;
      if (bridge) bridge.setPanelOpen(isChatOpen || isSettingsOpen);
    } catch (_) {}
  }, [isChatOpen, isSettingsOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

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
      });

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

  const navigateToCoords = (opt: NavOption) => {
    setNavOptions([]);
    try {
      const bridge = (window as any).DelamainNative;
      if (bridge) bridge.navigateToCoords(opt.lat, opt.lon, opt.name);
    } catch (_) {}
  };

  const saveSettings = () => {
    setSettings(tempSettings);
    setIsSettingsOpen(false);
  };

  return (
    <div className="flex h-screen bg-cyber-dark text-gray-200 font-mono overflow-hidden">
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
        <div className="mt-auto p-2 text-cyber-blue/50">
          <div className="w-2 h-2 rounded-full bg-cyber-blue animate-pulse" />
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
        <div className={`flex flex-col items-center justify-center p-6 pb-24 transition-all duration-300 ${isChatOpen ? 'flex-1 md:border-r border-cyber-gray' : 'flex-1 pr-16'}`}>
          <div className="mb-4 text-xs tracking-widest text-cyber-blue opacity-50 font-bold">
            DELAMAIN EXECUTIVE CAB SERVICE v4.2.0
          </div>
          <DelamainFace isTalking={isTalking} />
          <div className="mt-6 text-center">
            <h1 className="text-2xl font-bold tracking-tighter text-cyber-blue">EXCELSIOR PACKAGE</h1>
          </div>
        </div>

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
                <div className={`max-w-[85%] p-3 rounded-lg ${
                  msg.role === 'user' 
                    ? 'bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue ml-4' 
                    : 'bg-cyber-dark border border-gray-700 text-gray-300 mr-4'
                }`}>
                  <div className="flex items-center gap-2 mb-1 opacity-50 text-[10px] font-bold uppercase tracking-wider">
                    {msg.role === 'user' ? <User size={10} /> : <Terminal size={10} />}
                    {msg.role === 'user' ? settings.userName : 'Delamain'}
                  </div>
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-cyber-dark border border-gray-700 p-3 rounded-lg mr-4">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-cyber-blue rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-cyber-blue rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-cyber-blue rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-cyber-dark/80 border-t border-cyber-gray min-w-[450px]">
            <div className="relative flex items-center gap-2">
              {/* Keyboard trigger — focus input which summons soft keyboard on AAOS */}
              <button
                onClick={() => inputRef.current?.focus()}
                className="p-2 text-gray-500 hover:text-cyber-blue hover:bg-cyber-gray rounded-md transition-colors flex-shrink-0"
                title="Open keyboard"
              >
                <Keyboard size={20} />
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Direct thought input..."
                className="flex-1 bg-cyber-gray/50 border border-cyber-blue/20 rounded-md py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-cyber-blue/50 transition-colors text-cyber-blue placeholder-cyber-blue/30"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="absolute right-2 p-2 text-cyber-blue hover:bg-cyber-blue/10 rounded-md transition-colors disabled:opacity-30"
              >
                <Send size={20} />
              </button>
            </div>
            <div className="mt-2 text-[10px] text-gray-600 flex justify-between">
              <span>TAP ⌨ TO TYPE · ENTER TO SEND</span>
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
