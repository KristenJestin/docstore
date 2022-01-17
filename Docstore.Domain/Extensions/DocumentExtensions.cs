using Docstore.Domain.Entities;

namespace Docstore.Domain.Extensions
{
    public static class DocumentExtensions
    {
        public static Document WithFilesCount(this Document document, int count)
        {
            document.FilesCount = count;
            return document;
        }

        public static Document WithSize(this Document document, long size)
        {
            document.Size = size;
            return document;
        }
    }
}
