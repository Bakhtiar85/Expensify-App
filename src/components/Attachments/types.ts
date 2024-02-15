// This can be either a string, function, or number
type AttachmentSource = string | number | React.FC;

// Object shape for file where name is a required string
type AttachmentFile = {
    name: string;
};

// The object shape for the attachment
type Attachment = {
    /** Report action ID of the attachment */
    reportActionID?: string;

    /** Whether source url requires authentication */
    isAuthTokenRequired?: boolean;

    /** URL to full-sized attachment, SVG function, or numeric static image on native platforms */
    source: AttachmentSource;

    /** File object can be an instance of File or Object */
    file: AttachmentFile;

    /** Whether the attachment has been flagged */
    hasBeenFlagged?: boolean;

    /** The id of the transaction related to the attachment */
    transactionID?: string;

    isReceipt?: boolean;
};

export type {AttachmentSource, AttachmentFile, Attachment};
