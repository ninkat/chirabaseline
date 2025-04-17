import React from 'react';
import { useY } from 'react-yjs';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';

type PostData = {
  title: string;
  tags: string[];
};

export const DeepStructure: React.FC = () => {
  const doc = React.useContext(YjsContext);
  const yPosts = doc.getArray<Y.Map<string | Y.Array<string>>>('posts');
  const posts = useY(yPosts) as unknown as PostData[];

  // initialize default data if it doesn't exist
  React.useEffect(() => {
    if (yPosts.length === 0) {
      const yPost = new Y.Map<string | Y.Array<string>>();
      yPosts.push([yPost]);
      yPost.set('title', 'Notes');
      const yTags = new Y.Array<string>();
      yTags.push(['cooking', 'vegetables']);
      yPost.set('tags', yTags);
    }
  }, []);

  // get the first post's tags
  const firstPost = posts[0];
  const tags = firstPost?.tags || [];

  return (
    <>
      {tags.map((tag: string, index: number) => {
        return (
          <div key={`${tag}-${index}`}>
            {tag}
            <button
              onClick={() => {
                const yTags = yPosts.get(0).get('tags') as Y.Array<string>;
                yTags.delete(index);
              }}
            >
              x
            </button>
          </div>
        );
      })}
      <div>Result: {JSON.stringify(posts, null, 2)}</div>
    </>
  );
};
