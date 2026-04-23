import React, { useState, useEffect } from 'react';
import { Store, Star, Copy, RefreshCw, Send, MessageSquareText, ShieldCheck, MailWarning, MapPin, Search } from 'lucide-react';

interface Review {
  name: string;
  reviewId: string;
  reviewer: { displayName: string };
  starRating: string;
  comment: string;
  createTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  }
}

export default function App() {
  const [oauthToken, setOauthToken] = useState<string>('');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  
  const [generatedReply, setGeneratedReply] = useState('');
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  // OAuth PostMessage listener
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Validate origin for security
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        try {
          setIsConnecting(true);
          const redirectUri = `${window.location.origin}/auth/callback`;
          const response = await fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: event.data.code, redirectUri })
          });
          
          if (!response.ok) throw new Error("Failed to exchange token");
          
          const { access_token } = await response.json();
          setOauthToken(access_token);
        } catch (e: any) {
          setConnectionError(e.message || "OAuth exchange failed.");
        } finally {
          setIsConnecting(false);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Fetch reviews when token updates
  useEffect(() => {
    if (oauthToken) {
      loadReviews();
    }
  }, [oauthToken]);

  const handleConnectGoogle = async () => {
    setConnectionError('');
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await fetch(`/api/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`);
      if (!res.ok) throw new Error("Could not fetch OAuth URL");
      const { url } = await res.json();
      
      const authWindow = window.open(url, 'oauth_popup', 'width=600,height=700');
      if (!authWindow) {
        setConnectionError('Please allow popups for this site to connect your account.');
      }
    } catch (e: any) {
      setConnectionError(e.message || "Failed to initialize Google login.");
    } finally {
      setIsConnecting(false); // Only clears loading state of the URL fetch. Will spin again when code returns.
    }
  };

  const loadReviews = async () => {
    setIsFetching(true);
    try {
      const res = await fetch('/api/gmb/reviews', {
        headers: {
          'Authorization': `Bearer ${oauthToken}`
        }
      });
      if (!res.ok) {
         const data = await res.json();
         throw new Error(data.error || "Failed to fetch reviews");
      }
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch (e: any) {
      setConnectionError(e.message || "Failed to load Google Reviews. Ensure you have access to the business profile.");
    } finally {
      setIsFetching(false);
    }
  };

  const handleGenerate = async (review: Review) => {
    setIsGenerating(true);
    setGeneratedReply('');
    setCopied(false);

    try {
      // Map API star enum to number format
      const starMap: Record<string, string> = { "FIVE": "5", "FOUR": "4", "THREE": "3", "TWO": "2", "ONE": "1" };
      const starRatingStr = starMap[review.starRating] || review.starRating;

      const response = await fetch('/api/generate-review-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'Google',
          reviewerName: review.reviewer.displayName,
          starRating: starRatingStr,
          reviewText: review.comment || "[No text provided, only a rating]",
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setGeneratedReply(data.reply);
      } else {
        setGeneratedReply('Error: ' + (data.error || 'Failed to generate reply.'));
      }
    } catch (error) {
      setGeneratedReply('Error: Could not connect to the server.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectReview = (review: Review) => {
    setSelectedReview(review);
    setGeneratedReply(''); // Clear existing reply
    if(!review.reviewReply) {
       handleGenerate(review); // Auto-generate if unanswered
    } else {
       setGeneratedReply(review.reviewReply.comment); // Load existing reply
    }
  };

  const handlePostGoogle = async () => {
    if (!selectedReview || !generatedReply) return;
    setIsPosting(true);
    try {
      const res = await fetch('/api/gmb/reviews/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${oauthToken}`
        },
        body: JSON.stringify({
          reviewName: selectedReview.name,
          replyText: generatedReply
        })
      });
      
      if (!res.ok) throw new Error("Could not post reply");
      
      // Update local state to reflect it's replied
      setReviews(prev => prev.map(r => 
        r.name === selectedReview.name 
          ? { ...r, reviewReply: { comment: generatedReply, updateTime: new Date().toISOString() } } 
          : r
      ));
      
      alert("Successfully posted reply to Google Maps!");
      
    } catch (e: any) {
      alert("Error posting reply: " + e.message);
    } finally {
      setIsPosting(false);
    }
  };

  const handleCopy = () => {
    if (generatedReply) {
      navigator.clipboard.writeText(generatedReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const renderStars = (ratingStr: string) => {
    const starMap: Record<string, number> = { "FIVE": 5, "FOUR": 4, "THREE": 3, "TWO": 2, "ONE": 1 };
    const count = starMap[ratingStr] || 0;
    return (
      <div className="flex gap-[2px] text-[#D4AF37] text-xs mb-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={i < count ? "opacity-100" : "opacity-30"}>★</span>
        ))}
      </div>
    );
  };

  if (!oauthToken) {
    return (
      <div className="min-h-screen bg-[#0C0C0C] flex flex-col items-center justify-center p-4 font-sans text-[#E5E5E5]">
        <div className="bg-[#161616] p-10 rounded-3xl border border-[#2A2A2A] flex flex-col items-center text-center max-w-lg shadow-2xl relative overflow-hidden">
          {/* Subtle glow */}
          <div className="absolute top-0 -left-1/2 w-[200%] h-32 bg-gradient-to-b from-[#D4AF37]/5 to-transparent blur-3xl rounded-full pointer-events-none"></div>
          
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-[#D4AF37] to-[#A6892C] flex items-center justify-center text-black shadow-lg mb-6 z-10">
            <Store className="w-8 h-8" />
          </div>
          
          <h1 className="text-3xl font-serif text-[#D4AF37] italic tracking-tight mb-2 relative z-10">
            Tamrab Thai Inbox
          </h1>
          <p className="text-[#A0A0A0] text-sm mb-10 leading-relaxed font-light relative z-10 w-4/5 mx-auto">
            Connect your Google Business Profile to seamlessly fetch real reviews and auto-generate authentic, polite responses.
          </p>
          
          <button
            onClick={handleConnectGoogle}
            disabled={isConnecting}
            className="w-full max-w-xs flex items-center justify-center gap-3 bg-[#E5E5E5] hover:bg-white text-black font-semibold py-4 px-6 rounded-xl transition-all disabled:opacity-50 relative z-10 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            {isConnecting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <img src="https://cdn.worldvectorlogo.com/logos/google-icon-1.svg" alt="G" className="w-5 h-5" />}
            Connect with Google
          </button>
          
          {connectionError && (
             <div className="mt-6 flex items-start gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl border border-red-400/20 text-xs text-left w-full relative z-10">
               <MailWarning className="w-4 h-4 shrink-0 mt-0.5" />
               <p>{connectionError}</p>
             </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#E5E5E5] font-sans flex flex-col md:flex-row overflow-hidden absolute inset-0">
      
      {/* Sidebar - mimicking the theme specs slightly for authentic layout feeling */}
      <aside className="w-64 border-r border-[#2A2A2A] flex flex-col hidden lg:flex bg-[#0A0A0A]">
        <div className="p-8 pb-4">
          <h1 className="font-serif text-2xl text-[#D4AF37] italic tracking-tight">Tamrab Thai</h1>
          <p className="text-[10px] uppercase tracking-widest text-[#A0A0A0] mt-1">Review Engine</p>
        </div>
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-[#1A1A1A] rounded-xl text-white border border-[#2A2A2A]">
            <div className="flex items-center space-x-3">
              <span className="w-2 h-2 rounded-full bg-[#D4AF37]"></span>
              <span className="text-sm font-medium">Google Inbox</span>
            </div>
            <span className="text-[10px] bg-[#000] px-2 py-1 rounded-md text-[#A0A0A0]">{reviews.length}</span>
          </button>
        </nav>
        <div className="p-6 border-t border-[#2A2A2A]">
          <div className="flex items-center space-x-3 p-3 bg-[#161616] rounded-xl border border-[#2A2A2A]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#D4AF37] to-[#A6892C] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-black" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#E5E5E5]">Admin Active</p>
              <p className="text-[10px] text-[#A0A0A0]">Connected</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-20 border-b border-[#2A2A2A] flex items-center justify-between px-8 bg-[#0C0C0C] shrink-0">
          <h2 className="text-xl font-serif italic text-[#E5E5E5]">Response Dashboard</h2>
          <div className="flex space-x-8">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-[#A0A0A0] uppercase tracking-wider">Unreplied Found</p>
              <p className="text-lg font-medium text-[#D4AF37]">
                 {reviews.filter(r => !r.reviewReply).length}
              </p>
            </div>
            <button onClick={loadReviews} disabled={isFetching} className="flex items-center justify-center p-2 rounded-full hover:bg-[#1A1A1A] text-[#A0A0A0] hover:text-white transition-colors">
              <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative bg-[#080808]">
          
          {/* Inbox List Area */}
          <div className="w-full md:w-2/5 lg:w-1/3 flex flex-col border-r border-[#2A2A2A] bg-[#0C0C0C]">
             <div className="p-4 border-b border-[#2A2A2A] bg-[#111111]/50 flex items-center shrink-0">
                <Search className="w-4 h-4 text-[#A0A0A0] absolute ml-3" />
                <input type="text" placeholder="Search real reviews..." className="w-full bg-[#1A1A1A] border border-[#2A2A2A] text-sm text-[#E5E5E5] rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-[#D4AF37] transition-colors" />
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {isFetching && reviews.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#A0A0A0]">
                     <RefreshCw className="w-6 h-6 animate-spin mb-4" />
                     <p className="text-sm">Pulling reviews from Google...</p>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="text-center text-[#A0A0A0] mt-10 text-sm">No reviews found for this location.</div>
                ) : (
                  reviews.map((r, idx) => (
                    <button 
                      key={r.reviewId || idx}
                      onClick={() => handleSelectReview(r)}
                      className={`w-full text-left p-5 rounded-2xl border transition-all ${
                         selectedReview?.reviewId === r.reviewId 
                         ? 'bg-[#161616] border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.05)]' 
                         : 'bg-[#111111] border-[#2A2A2A] opacity-60 hover:opacity-100 hover:border-[#444]'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-semibold text-[#E5E5E5] truncate pr-2">{r.reviewer.displayName}</span>
                        <span className="text-[10px] text-[#A0A0A0] shrink-0 whitespace-nowrap">
                          {new Date(r.createTime).toLocaleDateString()}
                        </span>
                      </div>
                      
                      {renderStars(r.starRating)}
                      
                      <p className="text-xs text-[#A0A0A0] leading-relaxed line-clamp-3 italic">
                        {r.comment ? `"${r.comment}"` : "No comment provided."}
                      </p>
                      
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                         <div className="flex items-center space-x-2">
                            <MapPin className="w-2.5 h-2.5 text-blue-400" />
                            <span className="text-[10px] text-blue-400 font-mono">Google Maps</span>
                         </div>
                         {r.reviewReply && (
                            <span className="text-[9px] uppercase tracking-widest text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                               Replied
                            </span>
                         )}
                      </div>
                    </button>
                  ))
                )}
             </div>
          </div>

          {/* Composer Area */}
          <div className="w-full md:w-3/5 lg:w-2/3 p-6 md:p-10 flex flex-col bg-[#080808] overflow-y-auto">
            {!selectedReview ? (
               <div className="flex-1 flex flex-col items-center justify-center text-[#A0A0A0] gap-4">
                  <MessageSquareText className="w-12 h-12 opacity-20 text-[#D4AF37]" />
                  <p className="text-sm font-light">Select a review from the inbox to generate a reply.</p>
               </div>
            ) : (
               <div className="bg-[#161616] rounded-3xl border border-[#2A2A2A] p-8 md:p-10 flex flex-col shadow-2xl h-full min-h-[500px]">
                  <div className="flex items-center space-x-4 mb-8">
                    <div className="bg-[#D4AF37] p-2.5 rounded-xl text-black shrink-0 shadow-lg">
                      <MessageSquareText className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-serif text-xl italic text-[#E5E5E5]">AI Crafted Response</h3>
                      <p className="text-[10px] text-[#A0A0A0] uppercase tracking-widest mt-1">Gemini Engine • Professional Tone</p>
                    </div>
                  </div>

                  <div className="flex-1 bg-[#0C0C0C] rounded-2xl p-8 border border-[#2A2A2A] relative flex flex-col group">
                    {isGenerating ? (
                       <div className="flex-1 flex flex-col items-center justify-center text-[#A0A0A0] gap-4">
                          <RefreshCw className="w-6 h-6 animate-spin text-[#D4AF37]" />
                          <p className="text-sm uppercase tracking-widest font-mono text-[10px] animate-pulse">Analyzing Review Context...</p>
                       </div>
                    ) : (
                       <>
                          <div className="flex-1 text-[#D5D5D5] font-serif whitespace-pre-wrap leading-loose text-lg/relaxed overflow-y-auto custom-scrollbar">
                             {generatedReply || "No reply logic evaluated yet."}
                          </div>
                          
                          <div className="absolute bottom-4 right-6 text-[10px] text-[#A0A0A0] font-mono tracking-tighter uppercase">
                           {(generatedReply.match(/\w+/g) || []).length} WORDS • {selectedReview?.reviewReply ? 'ALREADY POSTED' : 'READY TO POST'}
                          </div>
                       </>
                    )}
                  </div>

                  <div className="mt-8 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    <button 
                       onClick={handleCopy}
                       disabled={isGenerating || !generatedReply}
                       className="text-[#A0A0A0] hover:text-white flex items-center space-x-2 transition-colors disabled:opacity-50"
                    >
                      <Copy className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-widest font-semibold">{copied ? 'Copied' : 'Copy Text'}</span>
                    </button>
                    
                    <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
                       <button 
                         onClick={() => handleGenerate(selectedReview)}
                         disabled={isGenerating || isPosting}
                         className="px-6 py-3.5 text-xs uppercase tracking-widest font-bold text-[#E5E5E5] border border-[#2A2A2A] bg-[#1A1A1A] rounded-full hover:bg-[#222] hover:border-[#444] transition-all disabled:opacity-50 disabled:cursor-not-allowed group flex justify-center items-center gap-2"
                       >
                         <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                         Regenerate
                       </button>
                       <button 
                         onClick={handlePostGoogle}
                         disabled={isGenerating || isPosting || !generatedReply || !!selectedReview?.reviewReply}
                         className="px-10 py-3.5 text-xs uppercase tracking-widest font-bold bg-[#D4AF37] text-black rounded-full hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 flex justify-center items-center gap-2 shadow-[0_0_15px_rgba(212,175,55,0.2)]"
                       >
                         {isPosting ? 'Posting...' : 'Post to Google'}
                         <Send className="w-3.5 h-3.5 -mt-0.5" />
                       </button>
                    </div>
                  </div>
               </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

