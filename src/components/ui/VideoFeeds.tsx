import React, { useRef, useEffect } from 'react';
import { useWebRTC } from '../../hooks/useWebRTC';

interface VideoFeedsProps {
  roomId: string;
  layout?: 'horizontal' | 'vertical'; // add layout prop with default vertical
}

// simplified styles
const styles = {
  videoContainer: {
    display: 'flex',
    gap: '0px',
  },
  videoContainerVertical: {
    flexDirection: 'column' as const,
  },
  videoContainerHorizontal: {
    flexDirection: 'row' as const,
  },
  videoItem: {
    width: '240px',
    height: '135px',
    backgroundColor: '#2d3748',
    borderRadius: '4px',
    overflow: 'hidden',
    boxSizing: 'border-box' as const,
  },
  localVideo: {
    border: '4px solid #3182ce',
  },
  videoElement: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    transform: 'scaleX(-1)', // mirror all videos by default
  },
};

// component to display a single video feed
const VideoFeed: React.FC<{ stream: MediaStream; isMuted: boolean }> = ({
  stream,
  isMuted,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isMuted}
      style={styles.videoElement}
    />
  );
};

// main component to display video feeds
const VideoFeeds: React.FC<VideoFeedsProps> = ({
  roomId,
  layout = 'vertical',
}) => {
  // use the WebRTC hook
  const { localStream, peerStreams, isConnected, startLocalVideo } =
    useWebRTC(roomId);

  // start video on mount
  useEffect(() => {
    if (isConnected) {
      startLocalVideo();
    }
  }, [isConnected, startLocalVideo]);

  // get the first peer stream for simplified UI
  const firstPeerStream =
    peerStreams.size > 0 ? Array.from(peerStreams.values())[0] : null;

  // determine container style based on layout prop
  const containerStyle = {
    ...styles.videoContainer,
    ...(layout === 'horizontal'
      ? styles.videoContainerHorizontal
      : styles.videoContainerVertical),
  };

  return (
    <div style={containerStyle}>
      {/* local video */}
      {localStream && (
        <div style={{ ...styles.videoItem, ...styles.localVideo }}>
          <VideoFeed stream={localStream} isMuted={true} />
        </div>
      )}

      {/* remote video */}
      {firstPeerStream && (
        <div style={styles.videoItem}>
          <VideoFeed stream={firstPeerStream} isMuted={false} />
        </div>
      )}
    </div>
  );
};

export default VideoFeeds;
