///
/// Source : https://tailwindcomponents.com/component/dragdrop-sortable-file-upload
///

// imports
import axios from 'axios'

// functions & data
const endpoint = '/api/DocumentFiles'

// main
const FileUploadInput = (baseFiles = []) => ({
    files: [],
    hover: false,
    fileDragging: null,
    fileDropping: null,
    humanFileSize(size) {
        const i = Math.floor(Math.log(size) / Math.log(1024))
        return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
    },
    async onFilesChange(files) {
        const extRegex = /(?:\.([^.]+))?$/

        for (const file of files) {
            if (file) {
                // TODO: split if text to long
                const index =
                    this.files.push({
                        file,
                        fileName: file.name,
                        mimeType: file.type,
                        size: file.size,
                        progress: 0,
                        uploaded: false,
                    }) - 1
                await this.uploadFile(file, index)
            }
        }
    },
    async uploadFile(file, index) {
        try {
            // config
            const form = new FormData()
            form.append('file', file)

            // http
            const { data } = await axios.post(endpoint, form, {
                onUploadProgress: ({ loaded, total }) => {
                    const fileLoaded = Math.floor((loaded / total) * 100)
                    const fileTotal = Math.floor(total / 1000)
                    this.files[index].progress = fileLoaded
                },
            })

            // done
            this.files[index] = {
                ...this.files[index],
                ...data,
                uploaded: true,
            }
        } catch (error) {
            // FIXME: use proper toaster error message
            alert(error)

            this.removeFile(index)
            // TODO: treat error
        }
    },
    loadFile(file) {
        return URL.createObjectURL(file.file)
    },
    removeFile(index) {
        this.files = this.files.filter((_, i) => i !== index)
    },
    drop(e) {
        const saveFile = this.files[this.fileDragging]
        this.files[this.fileDragging] = this.files[this.fileDropping]
        this.files[this.fileDropping] = saveFile

        this.fileDropping = null
        this.fileDragging = null
    },
    dragenter(e, index) {
        this.fileDropping = index
    },
    dragstart(e, index) {
        this.fileDragging = index
        e.dataTransfer.effectAllowed = 'move'
    },

    init() {
        this.files = baseFiles.map((file) => ({ ...file, progress: 100, uploaded: true }))
    },
})

// export
export default FileUploadInput
