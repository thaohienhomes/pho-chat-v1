'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';

interface BlogPost {
  category: 'blog' | 'newsletter' | 'changelog';
  date: string;
  description: string;
  emoji: string;
  image?: string;
  slug: string;
  title: string;
}

const posts: BlogPost[] = [
  {
    category: 'blog',
    date: '2026-03-08',
    description:
      'Ra mắt 3 tính năng mới cho gói Medical: Scientific Skills, Research Mode và Deep Research — công cụ AI mạnh mẽ cho nghiên cứu & học thuật.',
    emoji: '🔬',
    slug: 'march-2026-medical-features',
    title: 'Phở Medical — 3 Tính Năng AI Mới Cho Nghiên Cứu Y Khoa',
  },
  {
    category: 'changelog',
    date: '2026-02-25',
    description:
      'PubMed v2 phân trang & MeSH terms, Drug Interactions mở rộng 42 thuốc, OpenAlex, 3 model AI mới và trải nghiệm plugin liền mạch.',
    emoji: '🔬',
    slug: 'late-feb-2026-update',
    title: 'Phở Chat v1.135 — Plugins Y Khoa Nâng Cấp & Model AI Mới',
  },
  {
    category: 'blog',
    date: '2026-02-07',
    description:
      'Hướng dẫn chi tiết từng bước cách sử dụng Semantic Scholar, ArXiv, DOI Resolver và trích dẫn tự động.',
    emoji: '📖',
    image: '/images/generated/academic_research_manual_hero.png',
    slug: 'academic-research-manual',
    title: 'Hướng Dẫn Sử Dụng Module Nghiên Cứu Khoa Học',
  },
  {
    category: 'blog',
    date: '2026-02-07',
    description:
      'Chính thức ra mắt bộ công cụ Academic Research: Semantic Scholar, DOI Resolver, và IEEE Bibliography.',
    emoji: '🎓',
    image: '/images/blog/academic-research-banner.png',
    slug: 'academic-research-module',
    title: 'Ra Mắt Module Nghiên Cứu Khoa Học (Academic Research)',
  },
  {
    category: 'blog',
    date: '2026-02-04',
    description:
      'Ra mắt Phở Studio - Nền tảng tạo ảnh và video AI với FLUX, Kling, Stable Diffusion và nhiều model hàng đầu.',
    emoji: '🎨',
    image: '/images/blog/pho-studio.png',
    slug: 'pho-studio-launch',
    title: 'Phở Studio - Nền Tảng Tạo Ảnh & Video AI',
  },
  {
    category: 'blog',
    date: '2026-02-03',
    description:
      'Tìm hiểu về Gemini 2.0 Flash Thinking - mô hình AI với khả năng suy luận vượt trội từ Google.',
    emoji: '🧠',
    image: '/images/blog/gemini-flash.png',
    slug: 'gemini-flash-thinking',
    title: 'Gemini 2.0 Flash Thinking - AI Suy Luận Mới',
  },
  {
    category: 'blog',
    date: '2026-02-04',
    description:
      'Khám phá cách Phở Chat hỗ trợ nghiên cứu y sinh học với PubMed, ArXiv và các công cụ y khoa chuyên biệt.',
    emoji: '🔬',
    image: '/images/blog/pubmed-guide.png',
    slug: 'research-features',
    title: 'Trợ Lý AI Thông Minh Cho Nghiên Cứu Y Sinh Học',
  },
  {
    category: 'changelog',
    date: '2026-02-01',
    description:
      'Phở Points, gói Lifetime, và nhiều tính năng mới trong bản cập nhật tháng 2/2026.',
    emoji: '🎉',
    slug: 'february-2026-update',
    title: 'Phở Chat v1.132 - New Year Update',
  },
  {
    category: 'newsletter',
    date: '2026-01-15',
    description:
      'Tổng hợp các tính năng AI mới nhất và xu hướng công nghệ trong nghiên cứu y sinh học.',
    emoji: '📬',
    slug: 'ai-research-digest-jan-2026',
    title: 'AI Research Digest - Tháng 1/2026',
  },
];

const categoryConfig = {
  blog: {
    bg: 'rgba(168, 85, 247, 0.15)',
    color: '#c084fc',
    dot: '#a855f7',
    label: 'Blog',
  },
  changelog: {
    bg: 'rgba(34, 197, 94, 0.15)',
    color: '#4ade80',
    dot: '#22c55e',
    label: 'Changelog',
  },
  newsletter: {
    bg: 'rgba(59, 130, 246, 0.15)',
    color: '#60a5fa',
    dot: '#3b82f6',
    label: 'Newsletter',
  },
};

type Category = 'all' | 'blog' | 'newsletter' | 'changelog';

const tabs: { icon: string; id: Category; label: string }[] = [
  { icon: '✦', id: 'all', label: 'Tất Cả' },
  { icon: '✍️', id: 'blog', label: 'Blog' },
  { icon: '📬', id: 'newsletter', label: 'Newsletter' },
  { icon: '🚀', id: 'changelog', label: 'Changelog' },
];

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function BlogIndexPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('all');

  const filteredPosts =
    activeCategory === 'all' ? posts : posts.filter((p) => p.category === activeCategory);

  const [heroPost, ...gridPosts] = filteredPosts;

  const handleSubscribe = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        body: JSON.stringify({ email, source: 'blog' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
        setStatusMessage(data.message || 'Đăng ký thành công!');
        setEmail('');
      } else {
        setStatus('error');
        setStatusMessage(data.error || 'Có lỗi xảy ra');
      }
    } catch {
      setStatus('error');
      setStatusMessage('Không thể kết nối, vui lòng thử lại.');
    }
  };

  return (
    <>
      <title>Phở Chat Blog - Tin Tức, Changelog & Newsletter</title>
      <meta
        content="Cập nhật mới nhất từ Phở Chat - Blog, Newsletter và Changelog"
        name="description"
      />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #07071a;
          min-height: 100vh;
          color: #e2e2f0;
        }

        /* ── Page shell ─────────────────────────────────────────── */
        .blog-page {
          min-height: 100vh;
          background:
            radial-gradient(ellipse 80% 40% at 50% -10%, rgba(139,92,246,0.18) 0%, transparent 70%),
            radial-gradient(ellipse 60% 30% at 80% 60%, rgba(236,72,153,0.08) 0%, transparent 60%),
            #07071a;
        }

        .container {
          max-width: 1120px;
          margin: 0 auto;
          padding: 56px 24px 96px;
        }

        /* ── Back link ────────────────────────────────────────────── */
        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: rgba(255,255,255,0.45);
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 500;
          margin-bottom: 48px;
          transition: color 0.2s;
          letter-spacing: 0.01em;
        }
        .back-link:hover { color: rgba(255,255,255,0.8); }
        .back-link svg { width: 14px; height: 14px; }

        /* ── Header ────────────────────────────────────────────────── */
        .header {
          text-align: center;
          margin-bottom: 56px;
        }

        .header-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
          background: rgba(139,92,246,0.12);
          border: 1px solid rgba(139,92,246,0.25);
          border-radius: 100px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #c084fc;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 20px;
        }

        .title {
          font-size: clamp(2.2rem, 5vw, 3.2rem);
          font-weight: 800;
          line-height: 1.15;
          margin-bottom: 16px;
          background: linear-gradient(135deg, #f0e6ff 0%, #c084fc 40%, #f472b6 75%, #fb923c 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          background-size: 200% auto;
          animation: shimmer 4s linear infinite;
        }

        @keyframes shimmer {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }

        .subtitle {
          font-size: 1.05rem;
          color: rgba(255,255,255,0.55);
          max-width: 520px;
          margin: 0 auto;
          line-height: 1.65;
        }

        /* ── Nav tabs ──────────────────────────────────────────────── */
        .nav-tabs {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 52px;
          flex-wrap: wrap;
        }

        .nav-tab {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 22px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 100px;
          color: rgba(255,255,255,0.55);
          font-weight: 500;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.25s ease;
          letter-spacing: 0.01em;
          font-family: inherit;
        }

        .nav-tab:hover {
          background: rgba(139,92,246,0.12);
          border-color: rgba(139,92,246,0.3);
          color: rgba(255,255,255,0.9);
        }

        .nav-tab.active {
          background: linear-gradient(135deg, rgba(139,92,246,0.25), rgba(217,70,239,0.2));
          border-color: rgba(192,132,252,0.4);
          color: #f0e6ff;
          box-shadow: 0 0 20px rgba(139,92,246,0.2), inset 0 1px 0 rgba(255,255,255,0.1);
        }

        /* ── Hero post ─────────────────────────────────────────────── */
        .hero-card {
          display: block;
          text-decoration: none;
          color: inherit;
          position: relative;
          border-radius: 24px;
          overflow: hidden;
          margin-bottom: 28px;
          border: 1px solid rgba(139,92,246,0.2);
          background: linear-gradient(135deg, rgba(88,28,135,0.35) 0%, rgba(30,15,60,0.6) 50%, rgba(15,10,40,0.8) 100%);
          backdrop-filter: blur(20px);
          transition: all 0.35s ease;
          min-height: 260px;
          display: flex;
          align-items: center;
        }

        .hero-card:hover {
          border-color: rgba(192,132,252,0.45);
          transform: translateY(-3px);
          box-shadow: 0 24px 60px rgba(88,28,135,0.3), 0 0 0 1px rgba(192,132,252,0.15);
        }

        .hero-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 60% 80% at 90% 50%, rgba(217,70,239,0.12) 0%, transparent 70%),
                      radial-gradient(ellipse 40% 60% at 10% 20%, rgba(139,92,246,0.18) 0%, transparent 60%);
          pointer-events: none;
        }

        .hero-glow {
          position: absolute;
          right: -60px;
          top: 50%;
          transform: translateY(-50%);
          width: 360px;
          height: 360px;
          background: radial-gradient(circle, rgba(217,70,239,0.15) 0%, transparent 70%);
          pointer-events: none;
        }

        .hero-content {
          position: relative;
          z-index: 1;
          padding: 48px 52px;
          flex: 1;
        }

        .hero-badges {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .badge-new {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 12px;
          background: linear-gradient(135deg, #7c3aed, #db2777);
          border-radius: 100px;
          font-size: 0.72rem;
          font-weight: 700;
          color: #fff;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .badge-new::before {
          content: '';
          display: block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #fff;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.8); }
        }

        .hero-title {
          font-size: clamp(1.5rem, 3vw, 2rem);
          font-weight: 700;
          color: #f8f4ff;
          line-height: 1.3;
          margin-bottom: 14px;
          max-width: 680px;
        }

        .hero-description {
          font-size: 1rem;
          color: rgba(255,255,255,0.65);
          line-height: 1.65;
          max-width: 600px;
          margin-bottom: 28px;
        }

        .hero-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          background: linear-gradient(135deg, rgba(139,92,246,0.3), rgba(217,70,239,0.25));
          border: 1px solid rgba(192,132,252,0.35);
          border-radius: 12px;
          color: #e0d4ff;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.25s ease;
        }

        .hero-card:hover .hero-cta {
          background: linear-gradient(135deg, rgba(139,92,246,0.5), rgba(217,70,239,0.4));
          border-color: rgba(192,132,252,0.6);
          gap: 12px;
        }

        /* ── Posts grid ────────────────────────────────────────────── */
        .posts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }

        /* ── Post card ─────────────────────────────────────────────── */
        .post-card {
          background: rgba(255,255,255,0.028);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 20px;
          overflow: hidden;
          transition: all 0.3s ease;
          cursor: pointer;
          text-decoration: none;
          color: inherit;
          display: flex;
          flex-direction: column;
        }

        .post-card:hover {
          background: rgba(139,92,246,0.07);
          border-color: rgba(139,92,246,0.28);
          transform: translateY(-5px);
          box-shadow: 0 20px 48px rgba(88,28,135,0.22), 0 0 0 1px rgba(139,92,246,0.12);
        }

        /* Image area */
        .post-image-wrap {
          width: 100%;
          height: 188px;
          overflow: hidden;
          position: relative;
        }

        .post-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.4s ease;
        }

        .post-card:hover .post-image {
          transform: scale(1.05);
        }

        /* Emoji fallback area */
        .post-emoji-wrap {
          width: 100%;
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(88,28,135,0.3) 0%, rgba(17,8,40,0.5) 100%);
          position: relative;
          overflow: hidden;
        }

        .post-emoji-wrap::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(139,92,246,0.25) 0%, transparent 70%);
        }

        .post-emoji {
          font-size: 2.8rem;
          position: relative;
          z-index: 1;
          filter: drop-shadow(0 0 16px rgba(192,132,252,0.5));
        }

        /* Content */
        .post-content {
          padding: 22px 24px 24px;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .post-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .post-category {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 10px;
          border-radius: 100px;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .cat-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .post-date {
          font-size: 0.82rem;
          color: rgba(255,255,255,0.38);
          font-weight: 400;
        }

        .post-title {
          font-size: 1.1rem;
          font-weight: 650;
          color: #f2ecff;
          line-height: 1.45;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .post-description {
          font-size: 0.9rem;
          color: rgba(255,255,255,0.5);
          line-height: 1.65;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          flex: 1;
        }

        .post-read-more {
          font-size: 0.82rem;
          font-weight: 600;
          color: #a78bfa;
          margin-top: 4px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: gap 0.2s;
        }

        .post-card:hover .post-read-more { gap: 8px; }

        /* ── Empty state ───────────────────────────────────────────── */
        .empty-state {
          grid-column: 1 / -1;
          text-align: center;
          padding: 80px 24px;
          color: rgba(255,255,255,0.35);
          font-size: 1rem;
        }

        /* ── Newsletter ────────────────────────────────────────────── */
        .newsletter-section {
          margin-top: 80px;
          position: relative;
          padding: 52px 48px;
          border-radius: 28px;
          background: linear-gradient(135deg, rgba(37,16,80,0.7) 0%, rgba(20,10,50,0.8) 100%);
          text-align: center;
          overflow: hidden;
        }

        .newsletter-section::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 29px;
          padding: 1px;
          background: linear-gradient(135deg, rgba(139,92,246,0.5), rgba(217,70,239,0.4), rgba(59,130,246,0.3));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          animation: borderSpin 4s linear infinite;
          background-size: 200% 200%;
        }

        @keyframes borderSpin {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .newsletter-section::after {
          content: '';
          position: absolute;
          top: -40%;
          left: 50%;
          transform: translateX(-50%);
          width: 500px;
          height: 300px;
          background: radial-gradient(ellipse, rgba(139,92,246,0.12) 0%, transparent 70%);
          pointer-events: none;
        }

        .newsletter-icon {
          font-size: 2.2rem;
          margin-bottom: 12px;
          display: block;
        }

        .newsletter-title {
          font-size: 1.65rem;
          font-weight: 700;
          color: #f8f4ff;
          margin-bottom: 10px;
          position: relative;
          z-index: 1;
        }

        .newsletter-desc {
          color: rgba(255,255,255,0.6);
          margin-bottom: 28px;
          max-width: 460px;
          margin-left: auto;
          margin-right: auto;
          line-height: 1.65;
          position: relative;
          z-index: 1;
          font-size: 0.97rem;
        }

        .newsletter-form {
          display: flex;
          gap: 10px;
          max-width: 420px;
          margin: 0 auto;
          flex-wrap: wrap;
          justify-content: center;
          position: relative;
          z-index: 1;
        }

        .newsletter-input {
          flex: 1;
          min-width: 200px;
          padding: 13px 20px;
          background: rgba(0,0,0,0.35);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 14px;
          color: #fff;
          font-size: 0.95rem;
          outline: none;
          font-family: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .newsletter-input:focus {
          border-color: rgba(139,92,246,0.55);
          box-shadow: 0 0 0 3px rgba(139,92,246,0.15);
        }

        .newsletter-input::placeholder { color: rgba(255,255,255,0.33); }

        .newsletter-button {
          padding: 13px 28px;
          background: linear-gradient(135deg, #7c3aed 0%, #db2777 100%);
          border: none;
          border-radius: 14px;
          color: #fff;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 4px 20px rgba(124,58,237,0.4);
          font-family: inherit;
          white-space: nowrap;
        }

        .newsletter-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(124,58,237,0.55);
        }

        .newsletter-button:disabled { opacity: 0.6; cursor: not-allowed; }

        .status-message {
          margin-top: 14px;
          font-size: 0.9rem;
          position: relative;
          z-index: 1;
        }

        /* ── Footer ────────────────────────────────────────────────── */
        .footer {
          text-align: center;
          margin-top: 72px;
          padding-top: 36px;
          border-top: 1px solid rgba(255,255,255,0.07);
          color: rgba(255,255,255,0.35);
          font-size: 0.875rem;
        }

        .footer a {
          color: #a78bfa;
          text-decoration: none;
          transition: color 0.2s;
        }

        .footer a:hover { color: #c4b5fd; }

        /* ── Responsive ──────────────────────────────────────────────── */
        @media (max-width: 768px) {
          .hero-content { padding: 32px 28px; }
          .hero-title { font-size: 1.4rem; }
          .newsletter-section { padding: 40px 24px; }
          .posts-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 480px) {
          .container { padding: 40px 16px 80px; }
        }
      `}</style>

      <div className="blog-page">
        <div className="container">
          {/* Back link */}
          <Link className="back-link" href="/">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Quay lại Phở Chat
          </Link>

          {/* Header */}
          <header className="header">
            <div className="header-eyebrow">
              <span>✦</span>
              Phở Chat Blog
            </div>
            <h1 className="title">Tin Tức & Cập Nhật</h1>
            <p className="subtitle">
              Khám phá tính năng mới, hướng dẫn chuyên sâu và những câu chuyện từ team Phở Chat
            </p>
          </header>

          {/* Nav tabs */}
          <nav className="nav-tabs">
            {tabs.map((tab) => (
              <button
                className={`nav-tab${activeCategory === tab.id ? ' active' : ''}`}
                key={tab.id}
                onClick={() => setActiveCategory(tab.id)}
                type="button"
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Hero post */}
          {heroPost && (
            <Link className="hero-card" href={`/blog/${heroPost.slug}`}>
              <div className="hero-glow" />
              <div className="hero-content">
                <div className="hero-badges">
                  {heroPost.category === 'changelog' && <span className="badge-new">Mới Nhất</span>}
                  <span
                    className="post-category"
                    style={{
                      background: categoryConfig[heroPost.category].bg,
                      color: categoryConfig[heroPost.category].color,
                    }}
                  >
                    <span
                      className="cat-dot"
                      style={{ background: categoryConfig[heroPost.category].dot }}
                    />
                    {categoryConfig[heroPost.category].label}
                  </span>
                  <span className="post-date">{formatDate(heroPost.date)}</span>
                </div>
                <h2 className="hero-title">{heroPost.title}</h2>
                <p className="hero-description">{heroPost.description}</p>
                <span className="hero-cta">
                  Đọc ngay <span>→</span>
                </span>
              </div>
            </Link>
          )}

          {/* Grid */}
          {gridPosts.length > 0 ? (
            <div className="posts-grid">
              {gridPosts.map((post) => (
                <Link className="post-card" href={`/blog/${post.slug}`} key={post.slug}>
                  {post.image ? (
                    <div className="post-image-wrap">
                      <img
                        alt={post.title}
                        className="post-image"
                        loading="lazy"
                        src={post.image}
                      />
                    </div>
                  ) : (
                    <div className="post-emoji-wrap">
                      <span className="post-emoji">{post.emoji}</span>
                    </div>
                  )}
                  <div className="post-content">
                    <div className="post-meta">
                      <span
                        className="post-category"
                        style={{
                          background: categoryConfig[post.category].bg,
                          color: categoryConfig[post.category].color,
                        }}
                      >
                        <span
                          className="cat-dot"
                          style={{ background: categoryConfig[post.category].dot }}
                        />
                        {categoryConfig[post.category].label}
                      </span>
                      <span className="post-date">{formatDate(post.date)}</span>
                    </div>
                    <h2 className="post-title">{post.title}</h2>
                    <p className="post-description">{post.description}</p>
                    <span className="post-read-more">Đọc tiếp →</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            filteredPosts.length === 0 && (
              <div className="posts-grid">
                <div className="empty-state">Không có bài viết nào trong danh mục này.</div>
              </div>
            )
          )}

          {/* Newsletter */}
          <section className="newsletter-section">
            <span className="newsletter-icon">📬</span>
            <h2 className="newsletter-title">Đừng Bỏ Lỡ Cập Nhật Mới</h2>
            <p className="newsletter-desc">
              Nhận thông tin về tính năng AI mới nhất, nghiên cứu y sinh học và tips sử dụng Phở
              Chat ngay trong hộp thư của bạn.
            </p>
            <form className="newsletter-form" onSubmit={handleSubscribe}>
              <input
                className="newsletter-input"
                disabled={status === 'loading'}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                value={email}
              />
              <button className="newsletter-button" disabled={status === 'loading'} type="submit">
                {status === 'loading' ? 'Đang gửi...' : 'Đăng Ký'}
              </button>
            </form>
            {statusMessage && (
              <p
                className="status-message"
                style={{ color: status === 'success' ? '#4ade80' : '#f87171' }}
              >
                {statusMessage}
              </p>
            )}
          </section>

          {/* Footer */}
          <footer className="footer">
            <p>
              © 2026 <Link href="https://pho.chat">Phở Chat</Link> · Made with 💜 in Vietnam
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
