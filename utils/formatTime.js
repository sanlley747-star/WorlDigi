import Link from 'next/link';
import { formatCompactTime } from './utils'; // Tu nueva función

export default function PostItem({ post }) {
  // Llama a tu función personalizada
  const compactTime = formatCompactTime(post.created_at);

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-4">
      
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          
          <Link href={`/${post.username}`}>
            <img 
              src={post.avatar_url || '/default-avatar.png'} 
              alt={post.username} 
              className="w-10 h-10 rounded-full object-cover border border-gray-300 hover:opacity-80 transition-opacity cursor-pointer"
            />
          </Link>
          
          <div className="flex items-center space-x-2">
            <Link href={`/${post.username}`}>
              <h3 className="font-bold text-gray-900 text-sm hover:underline cursor-pointer">
                {post.username}
              </h3>
            </Link>
            
            {/* El punto separador y el nuevo formato de tiempo */}
            <span className="text-gray-400 text-sm">·</span>
            <span className="text-sm text-gray-500">{compactTime}</span>
          </div>
          
        </div>
      </div>

      <div className="text-gray-800 text-sm mb-3">
        {post.content}
      </div>

    </div>
  );
}
