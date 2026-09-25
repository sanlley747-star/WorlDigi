import React, { useState } from 'react';

export default function PostCard({ post, currentUserId, onLike, onRepost, onQuote }) {
    const [showRepostMenu, setShowRepostMenu] = useState(false);
    const [showQuoteModal, setShowQuoteModal] = useState(false);
    const [quoteText, setQuoteText] = useState('');

    return (
        <>
        <style>{'@keyframes bygetherRepostSheet{from{transform:translateY(100%)}to{transform:translateY(0)}}'}</style>
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

            {post.image_url && (
                <img src={post.image_url} alt={post.metadata?.og_title || 'Imagen de la publicación'}
                    className="w-full rounded-xl mb-4 max-h-[420px] object-cover" loading="lazy" />
            )}

            {post.metadata?.tipo === 'link_preview' && post.metadata?.url && (
                <a href={post.metadata.url} target="_blank" rel="noopener noreferrer"
                    className="block border border-gray-700 rounded-xl p-3 mb-4 hover:bg-gray-800 transition">
                    <div className="text-xs text-gray-400 mb-1">{post.metadata.domain || 'Enlace'}</div>
                    <div className="text-sm font-medium text-gray-100">{post.metadata.og_title || post.metadata.url}</div>
                    {post.metadata.og_description && (
                        <div className="text-xs text-gray-400 mt-1 line-clamp-2">{post.metadata.og_description}</div>
                    )}
                </a>
            )}

            {post.image_url && (
                <img src={post.image_url} alt={post.metadata?.og_title || 'Imagen de la publicación'}
                    className="w-full rounded-xl mb-4 max-h-[420px] object-cover" loading="lazy" />
            )}

            {post.metadata?.tipo === 'link_preview' && post.metadata?.url && (
                <a href={post.metadata.url} target="_blank" rel="noopener noreferrer"
                    className="block border border-gray-700 rounded-xl p-3 mb-4 hover:bg-gray-800 transition">
                    <div className="text-xs text-gray-400 mb-1">{post.metadata.domain || 'Enlace'}</div>
                    <div className="text-sm font-medium text-gray-100">{post.metadata.og_title || post.metadata.url}</div>
                    {post.metadata.og_description && (
                        <div className="text-xs text-gray-400 mt-1 line-clamp-2">{post.metadata.og_description}</div>
                    )}
                </a>
            )}

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
                    
                    {/* Menú flotante en escritorio / hoja emergente en móvil */}
                    {showRepostMenu && (
                        <>
                            <div className="hidden md:block absolute left-0 bottom-full mb-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden">
                                <button onClick={() => { onRepost(post.id); setShowRepostMenu(false); }} className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center space-x-2">
                                    <span>🔄</span> <span>Repostear ahora</span>
                                </button>
                                <button onClick={() => { setShowRepostMenu(false); setShowQuoteModal(true); }} className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center space-x-2 border-t border-gray-700">
                                    <span>✏️</span> <span>Citar publicación</span>
                                </button>
                            </div>

                            <div className="md:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setShowRepostMenu(false)} aria-hidden="true"></div>
                            <div className="md:hidden fixed inset-x-0 bottom-0 z-[51] bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl p-4" style={{ animation: 'bygetherRepostSheet .25s ease-out' }} role="dialog" aria-modal="true" aria-label="Opciones de repost">
                                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-600"></div>
                                <div className="space-y-1">
                                    <button onClick={() => { onRepost(post.id); setShowRepostMenu(false); }} className="w-full text-left px-4 py-3.5 text-sm text-gray-200 hover:bg-gray-800 rounded-xl flex items-center space-x-3">
                                        <span>🔄</span><span>Repostear ahora</span>
                                    </button>
                                    <button onClick={() => { onQuote(post.id); setShowRepostMenu(false); }} className="w-full text-left px-4 py-3.5 text-sm text-gray-200 hover:bg-gray-800 rounded-xl flex items-center space-x-3">
                                        <span>✏️</span><span>Citar publicación</span>
                                    </button>
                                    <button type="button" onClick={() => setShowRepostMenu(false)} className="w-full mt-2 px-4 py-3.5 text-sm font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-xl">
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

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

            {showQuoteModal && (
                <>
                    <div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setShowQuoteModal(false)} aria-hidden="true"></div>
                    <div className="fixed inset-0 z-[61] flex items-end md:items-center justify-center p-0 md:p-4">
                        <div className="w-full md:max-w-xl bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden"
                            role="dialog" aria-modal="true" aria-label="Citar publicación">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                                <h3 className="text-sm font-semibold text-gray-100">Citar publicación</h3>
                                <button type="button" onClick={() => setShowQuoteModal(false)}
                                    className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Cerrar">
                                    ×
                                </button>
                            </div>

                            <div className="p-4">
                                <div className="flex items-start space-x-3 mb-4">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white shrink-0">
                                        {post.currentUserInitials || post.viewerInitials || 'Tú'}
                                    </div>
                                    <textarea
                                        value={quoteText}
                                        onChange={(e) => setQuoteText(e.target.value)}
                                        placeholder="Añade un comentario a tu cita..."
                                        className="flex-1 min-h-[88px] resize-none bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none border-0 focus:ring-0"
                                        autoFocus
                                    />
                                </div>

                                <div className="border border-gray-700 rounded-xl p-3 bg-gray-950/40">
                                    <div className="flex items-center space-x-3 mb-3">
                                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white text-xs">
                                            {post.authorInitials || 'SS'}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-sm text-gray-100">{post.authorName || 'Sanlley Sánchez Pérez'}</h4>
                                            <span className="text-xs text-gray-400">@{post.authorHandle || 'sanylley'} · {post.timeAgo || '10m'}</span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-200 leading-relaxed">{post.content}</p>
                                    {post.image_url && (
                                        <img src={post.image_url} alt={post.metadata?.og_title || 'Imagen de la publicación'}
                                            className="w-full rounded-xl mt-3 max-h-[260px] object-cover" loading="lazy" />
                                    )}
                                    {post.metadata?.tipo === 'link_preview' && post.metadata?.url && (
                                        <a href={post.metadata.url} target="_blank" rel="noopener noreferrer"
                                            className="block border border-gray-700 rounded-xl p-3 mt-3">
                                            <div className="text-xs text-gray-400 mb-1">{post.metadata.domain || 'Enlace'}</div>
                                            <div className="text-sm font-medium text-gray-100">{post.metadata.og_title || post.metadata.url}</div>
                                        </a>
                                    )}
                                </div>

                                <div className="flex justify-end space-x-2 mt-4">
                                    <button type="button" onClick={() => setShowQuoteModal(false)}
                                        className="px-4 py-2.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-xl">
                                        Cancelar
                                    </button>
                                    <button type="button" onClick={() => {
                                        onQuote(post.id, quoteText);
                                        setQuoteText('');
                                        setShowQuoteModal(false);
                                    }}
                                        className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl">
                                        Citar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
