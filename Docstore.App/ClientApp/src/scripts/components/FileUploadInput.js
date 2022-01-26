// imports
import axios from 'axios'

// functions & data
const endpoint = '/api/DocumentFiles'

// main
const FileUploadInput = (baseFiles = []) => ({
    files: [],
    hover: false,
    async onFilesChange(files) {
        const extRegex = /(?:\.([^.]+))?$/

        for (const file of files) {
            if (file) {
                // TODO: split if text to long
                const index = this.files.push({ fileName: file.name, progress: 0 }) - 1
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
                    const fileSize =
                        fileTotal < 1024
                            ? fileTotal + ' KB'
                            : (loaded / (1024 * 1024)).toFixed(2) + ' MB'
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

            // TODO: treat error
        }
    },

    init() {
        this.files = baseFiles.map((file) => ({ ...file, progress: 100, uploaded: true }))
        console.log(this.files)
    },
})

// export
export default FileUploadInput
