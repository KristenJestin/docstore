using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class FolderShowViewModel
    {
        public Folder Folder { get; set; }

        public FolderShowViewModel(Folder folder)
        {
            Folder = folder;
        }
    }
}
