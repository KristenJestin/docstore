const TagsInput = (initalTags = []) => ({
    tagsList: undefined,
    tags: [],
    newTag: '',
    inputPaddingLeft: 0,

    clearNewTag() {
        this.newTag = ''
    },
    addTag(tag) {
        if (!tag || tag.match(/^ *$/) !== null) return

        this.tags.push(tag) // add the new tag to the tags array
        this.newTag = '' // reset newTag
    },
    removeTag(index) {
        this.tags.splice(index, 1)
    },
    removeLastTag() {
        this.newTag.length || this.removeTag(this.tags.length - 1)
    },
    onTagsChange() {
        if (!this.tagsList) return

        // set left padding
        this.inputPaddingLeft = this.tagsList.clientWidth
        // scroll tags ul to end
        this.tagsList.scrollTo(this.tagsList.scrollWidth, 0)
    },

    init() {
        this.tagsList = this.$refs.tagsList
        this.tags = initalTags

        this.$nextTick(() => this.onTagsChange())
        this.$watch('tags', () => this.onTagsChange())
    },
})

export default TagsInput
