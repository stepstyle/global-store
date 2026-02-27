import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User } from 'lucide-react';
import { sendMessageToGemini } from '../services/geminiService';
import { ChatMessage } from '../types';
import { useCart } from '../App';

const ChatBot: React.FC = () => {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined);
  const geminiEnabled = !!apiKey && apiKey.trim() !== "" && apiKey !== "PLACEHOLDER_API_KEY";

  const [isOpen, setIsOpen] = useState(false);
  const { t } = useCart();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  if (!geminiEnabled) return null;

  // Initialize welcome message when component mounts or language changes
  useEffect(() => {
    setMessages([
        {
          id: 'welcome',
          role: 'model',
          text: t('botWelcome'),
          timestamp: new Date()
        }
    ]);
  }, [t]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const responseText = await sendMessageToGemini(userMsg.text);
      
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div className="fixed bottom-6 left-6 rtl:left-6 ltr:right-6 rtl:right-auto z-50 flex flex-col items-start rtl:items-start ltr:items-end font-sans">
      {/* Chat Window */}
      {isOpen && (
        <div className="mb-4 w-80 md:w-96 bg-white/90 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/50 overflow-hidden flex flex-col h-[500px] animate-in slide-in-from-bottom-5 fade-in duration-300">
          
          {/* Header - Theme Gradient */}
          <div className="bg-gradient-to-r from-primary-DEFAULT to-secondary-DEFAULT p-4 flex justify-between items-center text-slate-900">
            <div className="flex items-center gap-2">
                <div className="p-1.5 bg-white/30 rounded-full text-slate-900">
                    <Bot size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-sm">{t('botName')}</h3>
                    <span className="text-xs text-slate-800 flex items-center gap-1 font-medium">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                        {t('online')}
                    </span>
                </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded-lg transition-colors text-slate-800">
              <X size={20} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary-DEFAULT text-slate-900 shadow-sm' : 'bg-secondary-light text-white shadow-sm'}`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`p-3 rounded-2xl max-w-[80%] text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-white text-slate-800 rounded-tr-none rtl:rounded-tr-none ltr:rounded-tl-none border border-slate-100' 
                    : 'bg-gradient-to-br from-secondary-DEFAULT to-secondary-dark text-white rounded-tl-none rtl:rounded-tl-none ltr:rounded-tr-none'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isTyping && (
                <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary-light text-white flex items-center justify-center shrink-0"><Bot size={16} /></div>
                    <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 flex gap-1 items-center">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 bg-white border-t border-slate-100">
            <div className="flex gap-2 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={t('typeMessage')}
                className="w-full bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-secondary-light outline-none"
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="absolute left-2 rtl:left-2 rtl:right-auto ltr:right-2 ltr:left-auto top-1.5 p-1.5 bg-primary-DEFAULT text-slate-900 rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={18} className="rtl:rotate-180 ltr:rotate-0" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group relative flex items-center justify-center w-14 h-14 bg-gradient-to-r from-primary-DEFAULT to-secondary-DEFAULT text-slate-900 rounded-full shadow-lg hover:shadow-secondary/50 transition-all duration-300 hover:scale-110 active:scale-95"
      >
        {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full border-2 border-secondary-DEFAULT animate-pulse"></span>
      </button>
    </div>
  );
};

export default ChatBot;