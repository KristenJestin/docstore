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
            const response = await fetch(endpoint, {
                method: form.getAttribute('method') || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: json,
            })
            const { status } = response
            const data = await response.json()
            if (status >= 200 && status < 300) {
                this.$dispatch('folder-change', { id: data.id, name: data.name })
                this.$dispatch('modal-ex')
            } else {
                // TODO: use 422 in backend
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
                // FIXME: use proper toaster error message
                alert('Something goes wrong with the folder creation')
            }
        } catch (error) {
            // FIXME: use proper toaster error message
            console.error(error)
        }
    },

    init() {
        this.prefix = prefix
    },
})

// export
export default FormFolderCreate
