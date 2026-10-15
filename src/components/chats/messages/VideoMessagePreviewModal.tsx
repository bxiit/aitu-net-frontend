import React, {ReactNode, Ref} from "react";

interface VideoMessagePreviewModalProps {
    videoPreviewRef: Ref<HTMLVideoElement>;
    children?: ReactNode; // recording controls, shown under the preview
}

export const VideoMessagePreviewModal: React.FC<VideoMessagePreviewModalProps> = ({videoPreviewRef, children}) => {

    return (
        <div
            className="fixed inset-0 z-40 min-h-full overflow-y-auto overflow-x-hidden transition flex items-center">
            {/* overlay */}
            <div aria-hidden="true" className="fixed inset-0 w-full h-full bg-black/50"/>

            {/* Modal */}
            <div className="relative w-full pointer-events-none transition my-auto p-4">
                <div
                    className="w-full py-4 bg-white cursor-default pointer-events-auto dark:bg-gray-800 relative rounded-xl mx-auto max-w-sm flex flex-col items-center gap-3">
                    <video className="rounded-full object-cover w-[250px] h-[250px] focus:outline-none"
                           ref={videoPreviewRef}
                           autoPlay={true}
                           muted={true}
                           playsInline={true}
                    />
                    {children}
                </div>
            </div>
        </div>
    )
}
