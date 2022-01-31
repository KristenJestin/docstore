using Docstore.App.Models.Abstracts;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class DocumentCreateViewModel : DocumentFormViewModel
    {
        public DocumentCreateViewModel(int? folderId = null, Folder? folder = null, IEnumerable<GetDocumentFileDto>? files = null) : base(folderId, folder, files)
        {
        }
    }
}
