// imports
import axios from 'axios'

// functions & data
const endpoint = '/api/Folders'

const formToJson = (form, prefix) => {
    const formEntries = new FormData(form).entries()
    const json = Object.assign(
        ...Array.from(formEntries, ([x, y]) => ({ [x.replace(prefix + '.', '')]: y }))
    )
    return JSON.stringify(json)
}

// main
const FormFolderCreate = (prefix = '') => ({
    errors: [],
    prefix: '',
    async submit() {
        const { form } = this.$refs
        const json = formToJson(form, prefix)

        try {
            const { data } = await axios({
                url: endpoint,
                method: form.getAttribute('method') || 'POST',
                data: json,
                headers: {
                    'Content-Type': 'application/json',
                },
            })

            // done
            this.$dispatch('folder-change', { id: data.id, name: data.name })
            this.$dispatch('modal-ex')
        } catch (error) {
            if (error.response) {
                const { data, status } = error.response

                if (status === 400) {
                    if (data.errors) {
                        for (const [key, error] of Object.entries(data.errors)) {
                            const input = form.querySelector(
                                `[name='${prefix !== '' ? prefix + '.' : ''}${key}']`
                            )
                            const errorContainer = input.nextElementSibling

                            errorContainer.classList.remove('hidden')
                            errorContainer.getElementsByClassName('field-validation')[0].innerHTML =
                                error[0]
                        }
                        return
                    }
                }
            }

            // FIXME: use proper toaster error message
            alert(error)
        }
    },

    init() {
        this.prefix = prefix
    },
})

// export
export default FormFolderCreate
