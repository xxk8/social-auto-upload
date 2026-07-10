"""Centralized CSS selectors and locator strings for the YouTube uploader.

When YouTube Studio's frontend changes, update ONLY this file.
"""


class YtLocators:
    """All YouTube Studio selector constants."""

    # ── URLs ──────────────────────────────────────────────────────────────
    STUDIO_URL = "https://studio.youtube.com"
    UPLOAD_URL = "https://www.youtube.com/upload"

    # ── Login ─────────────────────────────────────────────────────────────
    LOGIN_REDIRECT_FRAGMENT = "accounts.google.com"
    LOGIN_SIGNIN_FRAGMENT = "/signin"
    CHANNEL_URL_FRAGMENT = "/channel/"

    # ── Upload ────────────────────────────────────────────────────────────
    FILE_INPUT = 'input[type="file"]'
    DETAILS_DIALOG = "#title-textarea"
    TITLE_EDITOR = "#title-textarea #textbox"
    DESCRIPTION_EDITOR = "#description-textarea #textbox"

    # ── Thumbnail ─────────────────────────────────────────────────────────
    THUMB_INPUT = "#file-loader input[type='file'], ytcp-thumbnail-uploader input[type='file']"

    # ── Playlist ──────────────────────────────────────────────────────────
    PLAYLIST_DROPDOWN = "#basics ytcp-text-dropdown-trigger, ytcp-video-metadata-playlists ytcp-dropdown-trigger"
    PLAYLIST_CHECKBOX = "tp-yt-paper-checkbox:has-text('{playlist}'), ytcp-checkbox-group:has-text('{playlist}')"
    PLAYLIST_NEW_BUTTON = "ytcp-button:has-text('New playlist'), ytcp-button:has-text('创建播放列表')"
    PLAYLIST_NEW_ITEM = "tp-yt-paper-item:has-text('New playlist'), tp-yt-paper-item:has-text('新建播放列表')"
    PLAYLIST_TITLE_INPUT = "ytcp-playlist-metadata-editor #textbox, #create-playlist-form #textbox"
    PLAYLIST_CREATE_BUTTON = "ytcp-button#create-button, tp-yt-paper-dialog ytcp-button:has-text('Create'), tp-yt-paper-dialog ytcp-button:has-text('创建')"
    PLAYLIST_DIALOG_SAVE = "ytcp-playlist-dialog #save-button, ytcp-button:has-text('Done'), ytcp-button:has-text('完成')"
    PLAYLIST_DIALOG_CLOSE = "ytcp-button:has-text('Close'), ytcp-button:has-text('关闭'), #close-button"

    # ── Audience (made for kids) ──────────────────────────────────────────
    AUDIENCE_NOT_KIDS_RADIO = "tp-yt-paper-radio-button[name='VIDEO_MADE_FOR_KIDS_NOT_MFK']"
    AUDIENCE_NOT_KIDS_TEXT = "tp-yt-paper-radio-button:has-text('not made for kids'), tp-yt-paper-radio-button:has-text('不是面向儿童')"

    # ── Tags ──────────────────────────────────────────────────────────────
    TAGS_TOGGLE_BUTTON = "#toggle-button"
    TAGS_INPUT = "#tags-container #text-input, ytcp-form-input-container#tags-container input"

    # ── Navigation ────────────────────────────────────────────────────────
    NEXT_BUTTON = "#next-button"
    VISIBILITY_PUBLIC_RADIO = "tp-yt-paper-radio-button[name='PUBLIC']"

    # ── Publish ───────────────────────────────────────────────────────────
    DONE_BUTTON = "#done-button"
    VIDEO_LINK = "a[href*='youtu.be'], a[href*='watch?v=']"

    # ── Upload progress ───────────────────────────────────────────────────
    PROGRESS_SELECTORS = [
        ".progress-label",
        "span.progress-label",
        "ytcp-video-upload-progress",
    ]

    # ── Autocomplete dismissal ────────────────────────────────────────────
    AUTOCOMPLETE_DROPDOWN = "tp-yt-iron-dropdown:visible"
