// imports
import axios from 'axios'

// functions & data
const endpoint = '/api/Folders'

const debounce = (func, timeout = 300) => {
    let timer
    return (...args) => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            func.apply(this, args)
        }, timeout)
    }
}

const getData = async (search, success, error, always) => {
    try {
        const { data } = await axios.get(endpoint, { params: { search } })
        console.table(data)

        success && success(data)
        always && always()
    } catch (error) {
        error && error()
        always && always()
        // TODO: display a message
    }
}

const mod = (n, m) => ((n % m) + m) % m

// main
const SearchElementInput = (id, name) => ({
    search: '',
    data: [],
    open: false,
    loading: false,
    selectedId: null,
    selectedItem: undefined,
    selectionIndex: 0,
    onTyping() {
        if (this.search === '') return

        this.loading = true
        this.open = true
        this.data = []
    },
    async onSearch() {
        if (this.search === '') return

        await getData(
            this.search,
            (data) => {
                this.data = data
            },
            undefined,
            () => (this.loading = false)
        )
    },
    selectFolder(index) {
        const item = this.data[index]
        this.setFolder(item)

        this.close()
    },
    changeFolder(item) {
        this.setFolder(item)

        this.close()
    },
    setFolder(item) {
        this.selectedItem = item
        this.selectedId = item.id
        this.search = item.name
    },
    changeSelection(direction) {
        this.selectionIndex = mod(this.selectionIndex + direction, this.data.length)
    },
    cancel() {
        this.close()

        if (!this.selectedItem) {
            this.search = ''
            this.selectedId = undefined
            return
        }

        this.search = this.selectedItem.name
    },
    close() {
        this.open = false
    },
    init() {
        this.selectedId = id
        this.search = name
        this.selectedItem = { id, name }
    },
})

// export
export default SearchElementInput
