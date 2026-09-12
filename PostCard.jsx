import React, { useState } from 'react';

export default function PostCard({ post, currentUserId, onLike, onRepost, onQuote }) {
    const [showRepostMenu, setShowRepostMenu] = useState(false);

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4 text-gray-100 shadow-xl max-w-xl mx-auto">
            {/* Cabecera del Post */}
            <div className="flex items-center space-x-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white">
                    {post.authorInitials || 'SS'}
                </div>
                <div>
                    <h4 className="font-bold text-sm text-gray-100">{post.authorName || 'Sanlley Sánchez Pérez'}</h4>
                    <span className="text-xs text-gray-400">@{post.authorHandle || 'sanylley'} · {post.timeAgo || '10m'}</span>
                </div>
            </div>

            {/* Cuerpo del Post */}
            <p className="text-sm text-gray-200 mb-4 leading-relaxed">
                {post.content}
            </p>

            {/* Barra de Acciones Estilo X */}
            <div className="flex items-center justify-between border-t border-gray-800 pt-3 text-gray-400 max-w-md mx-auto relative">
                
                {/* Comentar */}
                <button onClick={() => post.onCommentClick(post.id)} className="flex items-center space-x-2 hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-gray-800">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    <span className="text-xs font-medium">{post.commentsCount || 24}</span>
                </button>

                {/* Repostear / Citar */}
                <div className="relative">
                    <button onClick={(e) => { e.stopPropagation(); setShowRepostMenu(!showRepostMenu); }} className="flex items-center space-x-2 hover:text-green-400 transition p-1.5 rounded-lg hover:bg-gray-800">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                        <span className="text-xs font-medium">{post.repostsCount || 12}</span>
                    </button>
                    
                    {/* Menú flotante */}
                    {showRepostMenu && (
                        <div className="absolute left-0 bottom-full mb-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden">
                            <button onClick={() => { onRepost(post.id); setShowRepostMenu(false); }} className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center space-x-2">
                                <span>🔄</span> <span>Repostear ahora</span>
                            </button>
                            <button onClick={() => { onQuote(post.id); setShowRepostMenu(false); }} className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center space-x-2 border-t border-gray-700">
                                <span>✏️</span> <span>Citar publicación</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Me Gusta (Corazón Rojo) */}
                <button onClick={() => onLike(post.id)} className="flex items-center space-x-2 text-red-500 transition p-1.5 rounded-lg hover:bg-gray-800">
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                    <span className="text-xs font-medium">{post.likesCount || 48}</span>
                </button>

                {/* Compartir (Cadenita) */}
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}`); alert("¡Enlace copiado!"); }} className="flex items-center space-x-2 hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-gray-800" title="Copiar enlace">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                </button>
            </div>
        </div>
    );
}
