using Docstore.Domain.Entities;

namespace Docstore.Domain.Extensions
{
    public static class FolderExtensions
    {
        public static Folder WithDocumentsCount(this Folder folder, int count)
        {
            folder.DocumentsCount = count;
            return folder;
        }
        public static Folder WithSize(this Folder folder, long size)
        {
            folder.Size = size;
            return folder;
        }
    }

}
